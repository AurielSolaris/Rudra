/**
 * The OpenAI-compatible adapter.
 *
 * One adapter, many back ends (PLAN.MD §4.4): Nous Portal, OpenRouter, OpenAI,
 * Together, Groq, Ollama, LM Studio, vLLM. They agree on `/chat/completions`
 * and on the streamed chunk shape, and they disagree about almost everything
 * else — which is why this file is defensive about fields it did not send.
 *
 * **Everything read off the socket is bounded** (INVARIANT 19). A provider is
 * an untrusted peer for this purpose: not because it is hostile, but because a
 * wedged or misbehaving endpoint is exactly the case a limit is for. Three
 * ceilings apply, all named in `limits.ts`:
 *
 *  - a single SSE frame may not exceed `MAX_SSE_FRAME_BYTES`
 *  - accumulated output may not exceed `MAX_MESSAGE_CHARS`
 *  - an error body is read up to `MAX_ERROR_BODY_BYTES` and no further
 */

import type { ModelInfoT } from '@rudra/contracts';
import { createLogger } from '@rudra/shared/logger';
import { MAX_ERROR_BODY_BYTES, MAX_MESSAGE_CHARS, MAX_SSE_FRAME_BYTES } from '@rudra/shared/limits';
import {
   appError,
   ErrorCode,
   fail,
   ok,
   throwApp,
   type AppError,
   type Result,
} from '@rudra/shared/result';
import type {
   CompletionRequest,
   ProviderAdapter,
   ProviderCredentials,
   ProviderEvent,
   ProviderStopReason,
} from './types.ts';

const log = createLogger('provider:openai');

export interface OpenAiCompatibleOptions {
   readonly id: string;
   readonly baseUrl: string;
   /**
    * Ask for token usage on the final streamed chunk.
    *
    * On by default because the number is genuinely useful and most back ends
    * either support it or ignore it. A strict server that rejects unknown
    * request fields can turn it off in config rather than losing streaming.
    */
   readonly includeUsage?: boolean;
   /** Injected in tests. Defaults to the global `fetch`. */
   readonly fetchImpl?: typeof fetch;
}

/** Trim one trailing slash so `${base}/chat/completions` is never doubled. */
function normalizeBase(baseUrl: string): string {
   return baseUrl.replace(/\/+$/, '');
}

/**
 * Map a provider's `finish_reason` onto ours.
 *
 * An unrecognised value becomes `complete` rather than throwing: the stream did
 * end, and failing a finished generation over a word we do not know would throw
 * away a good answer. It is logged, because a new value is worth noticing.
 */
function stopReason(raw: unknown): ProviderStopReason {
   switch (raw) {
      case 'stop':
      case 'end_turn':
         return 'complete';
      case 'length':
      case 'max_tokens':
         return 'length';
      case 'tool_calls':
      case 'function_call':
         return 'tool_calls';
      default:
         if (raw !== null && raw !== undefined) {
            // JSON.stringify rather than String(): a provider that sends an
            // object here would otherwise log `[object Object]`, which tells
            // whoever reads it nothing about what to add to the switch.
            log.warn('unrecognised finish_reason', { raw: JSON.stringify(raw) });
         }
         return 'complete';
   }
}

/** Read an error body without letting a huge one become our problem. */
async function readErrorBody(response: Response): Promise<string> {
   const body = response.body;
   if (body === null) return '';

   const reader = body.getReader();
   const decoder = new TextDecoder();
   let text = '';
   try {
      while (text.length < MAX_ERROR_BODY_BYTES) {
         const { done, value } = await reader.read();
         if (done) break;
         text += decoder.decode(value, { stream: true });
      }
   } catch {
      // A truncated error body is still better than none.
   } finally {
      await reader.cancel().catch(() => undefined);
   }
   return text.slice(0, MAX_ERROR_BODY_BYTES);
}

/**
 * Pull a useful message out of an error body.
 *
 * Providers disagree on the shape — `{error:{message}}`, `{error:"..."}`,
 * `{message}`, or plain text — so this tries each and falls back to the status.
 */
function describeUpstream(status: number, body: string): AppError {
   let detail = body.trim();
   try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === 'object' && parsed !== null) {
         const record = parsed as Record<string, unknown>;
         const error = record['error'];
         if (typeof error === 'string') detail = error;
         else if (typeof error === 'object' && error !== null) {
            const message = (error as Record<string, unknown>)['message'];
            if (typeof message === 'string') detail = message;
         } else if (typeof record['message'] === 'string') {
            detail = record['message'];
         }
      }
   } catch {
      // Not JSON. The raw text is the best we have.
   }

   // 401/403 are the overwhelmingly common failure and deserve a message that
   // tells the user what to do rather than echoing a provider's prose.
   if (status === 401 || status === 403) {
      return appError(ErrorCode.Upstream, 'The provider rejected the API key.', {
         detail: { status, upstream: detail.slice(0, 500) },
      });
   }
   if (status === 429) {
      return appError(ErrorCode.Upstream, 'The provider is rate limiting this key.', {
         detail: { status, upstream: detail.slice(0, 500) },
      });
   }
   return appError(
      ErrorCode.Upstream,
      detail === '' ? `The provider returned HTTP ${status}.` : detail.slice(0, 500),
      { detail: { status } },
   );
}

/**
 * Split a byte stream into SSE data payloads, with a hard frame ceiling.
 *
 * Yields the text after `data: ` for each event, in order. A buffer that passes
 * `MAX_SSE_FRAME_BYTES` without a frame boundary means the peer is not speaking
 * our protocol, and continuing to accumulate it is how a parser becomes an OOM.
 */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
   const reader = body.getReader();
   const decoder = new TextDecoder();
   let buffer = '';

   try {
      for (;;) {
         const { done, value } = await reader.read();
         if (done) break;

         buffer += decoder.decode(value, { stream: true });

         if (buffer.length > MAX_SSE_FRAME_BYTES) {
            throwApp(
               appError(
                  ErrorCode.Upstream,
                  `The provider sent more than ${MAX_SSE_FRAME_BYTES} bytes without a frame boundary.`,
               ),
            );
         }

         let split: number;
         // Accept bare \n as well as \r\n: not every back end sends CRLF.
         while ((split = buffer.search(/\r?\n\r?\n/)) !== -1) {
            const raw = buffer.slice(0, split);
            buffer = buffer.slice(
               split + (buffer.slice(split, split + 4).includes('\r\n\r\n') ? 4 : 2),
            );

            for (const line of raw.split(/\r?\n/)) {
               if (line.startsWith('data:')) yield line.slice(5).trimStart();
            }
         }
      }
   } finally {
      // Closes the socket when the consumer stops pulling, which is what makes
      // interruption actually cancel the upstream request.
      await reader.cancel().catch(() => undefined);
   }
}

export function createOpenAiCompatible(options: OpenAiCompatibleOptions): ProviderAdapter {
   const base = normalizeBase(options.baseUrl);
   const doFetch = options.fetchImpl ?? fetch;

   function headers(credentials: ProviderCredentials): Record<string, string> {
      const out: Record<string, string> = { 'content-type': 'application/json' };
      // Several local back ends need no key at all, and sending `Bearer
      // undefined` makes them fail in a confusing way.
      if (credentials.apiKey !== undefined && credentials.apiKey !== '') {
         out['authorization'] = `Bearer ${credentials.apiKey}`;
      }
      return out;
   }

   return {
      id: options.id,
      kind: 'openai_compatible',

      async *stream(
         request: CompletionRequest,
         credentials: ProviderCredentials,
      ): AsyncGenerator<ProviderEvent> {
         const payload: Record<string, unknown> = {
            model: request.model,
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
            stream: true,
         };
         if (request.temperature !== undefined) payload['temperature'] = request.temperature;
         if (request.maxTokens !== undefined) payload['max_tokens'] = request.maxTokens;
         if (options.includeUsage !== false) payload['stream_options'] = { include_usage: true };

         const response = await doFetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: headers(credentials),
            body: JSON.stringify(payload),
            ...(request.signal !== undefined ? { signal: request.signal } : {}),
         });

         if (!response.ok) {
            throwApp(describeUpstream(response.status, await readErrorBody(response)));
         }
         if (response.body === null) {
            throwApp(appError(ErrorCode.Upstream, 'The provider returned no body for a stream.'));
         }

         let emitted = 0;
         let reason: ProviderStopReason = 'complete';
         let sawTerminator = false;

         for await (const data of sseData(response.body)) {
            if (data === '[DONE]') {
               sawTerminator = true;
               break;
            }

            let chunk: Record<string, unknown>;
            try {
               chunk = JSON.parse(data) as Record<string, unknown>;
            } catch {
               // A malformed chunk among good ones is not worth killing a live
               // generation over; the next one usually parses.
               log.warn('skipped unparseable stream chunk');
               continue;
            }

            // Some back ends report a mid-stream error as a normal chunk.
            if (chunk['error'] !== undefined) {
               throwApp(describeUpstream(response.status, data));
            }

            const usage = chunk['usage'];
            if (typeof usage === 'object' && usage !== null) {
               const record = usage as Record<string, unknown>;
               const tokensIn = record['prompt_tokens'];
               const tokensOut = record['completion_tokens'];
               yield {
                  type: 'usage',
                  ...(typeof tokensIn === 'number' ? { tokensIn } : {}),
                  ...(typeof tokensOut === 'number' ? { tokensOut } : {}),
               };
            }

            const choices = chunk['choices'];
            if (!Array.isArray(choices) || choices.length === 0) continue;
            const choice = choices[0] as Record<string, unknown> | undefined;
            if (choice === undefined) continue;

            if (choice['finish_reason'] !== null && choice['finish_reason'] !== undefined) {
               reason = stopReason(choice['finish_reason']);
            }

            const delta = choice['delta'];
            const text =
               typeof delta === 'object' && delta !== null
                  ? (delta as Record<string, unknown>)['content']
                  : undefined;
            if (typeof text !== 'string' || text === '') continue;

            // A provider that never terminates is a real failure mode — a
            // broken stop sequence will do it. At the ceiling the message
            // completes with `length`, which is already a state the UI renders,
            // so the cap degrades into a designed outcome instead of an error.
            if (emitted + text.length > MAX_MESSAGE_CHARS) {
               const room = MAX_MESSAGE_CHARS - emitted;
               if (room > 0) yield { type: 'delta', text: text.slice(0, room) };
               log.warn('message hit the character ceiling', { limit: MAX_MESSAGE_CHARS });
               yield { type: 'done', reason: 'length' };
               return;
            }

            emitted += text.length;
            yield { type: 'delta', text };
         }

         if (!sawTerminator) {
            // The socket closed without `[DONE]`. The text we have is real, so
            // it is reported as a finished message rather than discarded — but
            // it is worth a log line, because a healthy provider terminates.
            log.debug('stream ended without a [DONE] terminator');
         }

         yield { type: 'done', reason };
      },

      async listModels(credentials: ProviderCredentials): Promise<Result<ModelInfoT[]>> {
         try {
            const response = await doFetch(`${base}/models`, { headers: headers(credentials) });
            if (!response.ok) {
               return fail.upstream(`The provider returned HTTP ${response.status} for /models.`);
            }

            const parsed: unknown = await response.json();
            const data = (parsed as { data?: unknown } | null)?.data;
            if (!Array.isArray(data)) {
               return fail.upstream('The provider’s /models response had no `data` array.');
            }

            const models: ModelInfoT[] = [];
            for (const entry of data) {
               const id = (entry as { id?: unknown } | null)?.id;
               if (typeof id === 'string' && id !== '') models.push({ id });
            }
            return ok(models);
         } catch (cause) {
            // An endpoint with no /models route is normal, not an error state.
            return fail.upstream('Could not reach the provider to list models.', cause);
         }
      },
   };
}
