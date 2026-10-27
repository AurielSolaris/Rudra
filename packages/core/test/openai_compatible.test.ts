/**
 * The OpenAI-compatible adapter.
 *
 * Every test here drives a fake `fetch`, so the suite needs no network, no key
 * and no provider. What is under test is the parsing and the bounds, which is
 * where the bugs are: back ends disagree about framing, about whether usage is
 * reported, about whether they bother to send `[DONE]`, and about what they do
 * when something goes wrong mid-stream.
 */

import { describe, expect, it } from 'bun:test';
import { MAX_MESSAGE_CHARS, MAX_SSE_FRAME_BYTES } from '@rudra/shared/limits';
import { toAppError, type AppError } from '@rudra/shared/result';
import { createOpenAiCompatible } from '../providers/openai_compatible.ts';
import type { ProviderEvent } from '../providers/types.ts';

interface Call {
   url: string;
   init: RequestInit | undefined;
}

/**
 * A `fetch` that answers from a handler, recording what it was asked.
 *
 * One cast, in one place, instead of a cast at every call site — the shape of
 * `fetch` is wider than anything these tests need to produce.
 */
function fakeFetch(handler: (call: Call) => Response): {
   fetchImpl: typeof fetch;
   calls: Call[];
} {
   const calls: Call[] = [];
   const impl = (input: unknown, init?: RequestInit): Promise<Response> => {
      const call: Call = { url: String(input), init };
      calls.push(call);
      return Promise.resolve(handler(call));
   };
   return { fetchImpl: impl as unknown as typeof fetch, calls };
}

/** A fake that replies with `body` as an event-stream. */
function streaming(body: string, status = 200): typeof fetch {
   return fakeFetch(
      () => new Response(body, { status, headers: { 'content-type': 'text/event-stream' } }),
   ).fetchImpl;
}

/** The request body these fakes are always sent: a JSON string, never a stream. */
function bodyOf(call: Call | undefined): string {
   const body = call?.init?.body;
   return typeof body === 'string' ? body : '';
}

function chunk(text: string, finish: string | null = null): string {
   return `data: ${JSON.stringify({
      choices: [{ delta: { content: text }, finish_reason: finish }],
   })}\n\n`;
}

function adapter(fetchImpl: typeof fetch, includeUsage = true) {
   return createOpenAiCompatible({
      id: 'test',
      baseUrl: 'http://127.0.0.1:1/v1',
      includeUsage,
      fetchImpl,
   });
}

async function collect(events: AsyncGenerator<ProviderEvent>): Promise<ProviderEvent[]> {
   const out: ProviderEvent[] = [];
   for await (const event of events) out.push(event);
   return out;
}

/**
 * Run a stream that is expected to fail and return the error it threw.
 *
 * Written as try/catch rather than `expect().rejects` so the caught value keeps
 * its type and can be asserted on as an `AppError`.
 */
async function failureOf(events: AsyncGenerator<ProviderEvent>): Promise<AppError> {
   try {
      await collect(events);
   } catch (cause) {
      return toAppError(cause);
   }
   throw new Error('expected the stream to fail, but it completed');
}

function textOf(events: readonly ProviderEvent[]): string {
   return events
      .filter((e): e is Extract<ProviderEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
}

const request = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('streaming', () => {
   it('reassembles deltas in order and ends with exactly one done', async () => {
      const body = chunk('Hel') + chunk('lo') + chunk('', 'stop') + 'data: [DONE]\n\n';
      const events = await collect(adapter(streaming(body)).stream(request, {}));

      expect(textOf(events)).toBe('Hello');
      expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
      expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' });
   });

   it('accepts bare \\n framing as well as \\r\\n', async () => {
      // Not every back end sends CRLF, and a parser that insists on it reads a
      // perfectly good stream as one unterminated frame.
      const crlf = `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\r\n\r\n`;
      const events = await collect(
         adapter(streaming(crlf + 'data: [DONE]\n\n')).stream(request, {}),
      );
      expect(events[0]).toEqual({ type: 'delta', text: 'ok' });
   });

   it('maps finish_reason into our vocabulary', async () => {
      for (const [raw, expected] of [
         ['stop', 'complete'],
         ['length', 'length'],
         ['max_tokens', 'length'],
         ['tool_calls', 'tool_calls'],
      ] as const) {
         const events = await collect(
            adapter(streaming(chunk('x', raw) + 'data: [DONE]\n\n')).stream(request, {}),
         );
         expect(events.at(-1)).toEqual({ type: 'done', reason: expected });
      }
   });

   it('treats an unknown finish_reason as complete rather than failing', async () => {
      // The generation did finish. Throwing away a good answer over a word we
      // do not recognise would be the worse bug.
      const events = await collect(
         adapter(streaming(chunk('x', 'something_new') + 'data: [DONE]\n\n')).stream(request, {}),
      );
      expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' });
   });

   it('reports usage when the provider volunteers it', async () => {
      const usage = `data: ${JSON.stringify({
         choices: [],
         usage: { prompt_tokens: 11, completion_tokens: 22 },
      })}\n\n`;
      const events = await collect(
         adapter(streaming(chunk('x') + usage + 'data: [DONE]\n\n')).stream(request, {}),
      );
      expect(events).toContainEqual({ type: 'usage', tokensIn: 11, tokensOut: 22 });
   });

   it('omits usage entirely when the provider never sends it', async () => {
      // A fabricated estimate in a field the UI shows as a cost is worse than
      // an honest blank, so nothing is invented here.
      const events = await collect(
         adapter(streaming(chunk('x') + 'data: [DONE]\n\n')).stream(request, {}),
      );
      expect(events.some((e) => e.type === 'usage')).toBe(false);
   });

   it('skips an unparseable chunk instead of killing a live generation', async () => {
      const body = chunk('a') + 'data: {not json\n\n' + chunk('b') + 'data: [DONE]\n\n';
      const events = await collect(adapter(streaming(body)).stream(request, {}));
      expect(textOf(events)).toBe('ab');
   });

   it('still completes when the provider omits [DONE]', async () => {
      const events = await collect(adapter(streaming(chunk('x', 'stop'))).stream(request, {}));
      expect(events.at(-1)).toEqual({ type: 'done', reason: 'complete' });
   });

   it('sends stream_options only when usage is wanted', async () => {
      const wanted = fakeFetch(() => new Response('data: [DONE]\n\n', { status: 200 }));
      await collect(adapter(wanted.fetchImpl, true).stream(request, {}));
      expect(bodyOf(wanted.calls[0])).toContain('stream_options');

      // A strict back end that rejects unknown fields can turn it off without
      // losing streaming altogether.
      const not = fakeFetch(() => new Response('data: [DONE]\n\n', { status: 200 }));
      await collect(adapter(not.fetchImpl, false).stream(request, {}));
      expect(bodyOf(not.calls[0])).not.toContain('stream_options');
   });

   it('omits the Authorization header when there is no key', async () => {
      // Local back ends need no key, and `Bearer undefined` makes them fail in
      // a way that reads like a credential problem.
      const spy = fakeFetch(() => new Response('data: [DONE]\n\n', { status: 200 }));

      await collect(adapter(spy.fetchImpl).stream(request, {}));
      expect(new Headers(spy.calls[0]?.init?.headers).has('authorization')).toBe(false);

      await collect(adapter(spy.fetchImpl).stream(request, { apiKey: 'k' }));
      expect(new Headers(spy.calls[1]?.init?.headers).get('authorization')).toBe('Bearer k');
   });
});

describe('failures are reported, never guessed at', () => {
   it('turns 401 into a message about the key', async () => {
      const body = JSON.stringify({ error: { message: 'bad key' } });
      const error = await failureOf(adapter(streaming(body, 401)).stream(request, {}));
      expect(error.code).toBe('upstream');
      expect(error.message).toContain('API key');
   });

   it('turns 429 into a message about rate limiting', async () => {
      const error = await failureOf(adapter(streaming('{}', 429)).stream(request, {}));
      expect(error.message).toContain('rate limiting');
   });

   it('surfaces a mid-stream error chunk', async () => {
      // Several back ends report a failure as a normal-looking chunk rather
      // than by closing the connection.
      const body = chunk('partial') + `data: ${JSON.stringify({ error: { message: 'boom' } })}\n\n`;
      const error = await failureOf(adapter(streaming(body)).stream(request, {}));
      expect(error.code).toBe('upstream');
   });

   it('reads an error body of any shape', async () => {
      for (const body of [
         JSON.stringify({ error: { message: 'nested' } }),
         JSON.stringify({ error: 'flat' }),
         JSON.stringify({ message: 'bare' }),
         'plain text',
      ]) {
         const error = await failureOf(adapter(streaming(body, 500)).stream(request, {}));
         expect(error.code).toBe('upstream');
      }
   });
});

describe('everything off the socket is bounded (INVARIANT 19)', () => {
   it('refuses a frame that never ends', async () => {
      // Not hostility — a wedged endpoint is exactly the case a ceiling is for.
      const endless = `data: ${'x'.repeat(MAX_SSE_FRAME_BYTES + 1024)}`;
      const error = await failureOf(adapter(streaming(endless)).stream(request, {}));
      expect(error.code).toBe('upstream');
   });

   it('caps an endless message and completes it as `length`', async () => {
      // A broken stop sequence will do this. The cap has to degrade into a
      // state the UI already renders, not into an error.
      const big = chunk('y'.repeat(MAX_MESSAGE_CHARS + 500), null);
      const events = await collect(adapter(streaming(big)).stream(request, {}));

      expect(textOf(events)).toHaveLength(MAX_MESSAGE_CHARS);
      expect(events.at(-1)).toEqual({ type: 'done', reason: 'length' });
   });
});

describe('listModels', () => {
   it('reads the data array', async () => {
      const body = JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] });
      const result = await adapter(streaming(body)).listModels({});

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.map((m) => m.id)).toEqual(['a', 'b']);
   });

   it('fails softly when the endpoint has no /models route', async () => {
      // Normal for vLLM and several proxies. The UI offers a text field; this
      // is information, not an error state.
      const result = await adapter(streaming('nope', 404)).listModels({});
      expect(result.ok).toBe(false);
   });

   it('does not double the slash when the base URL has a trailing one', async () => {
      const spy = fakeFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }));

      await createOpenAiCompatible({
         id: 't',
         baseUrl: 'http://127.0.0.1:1/v1/',
         fetchImpl: spy.fetchImpl,
      }).listModels({});

      expect(spy.calls[0]?.url).toBe('http://127.0.0.1:1/v1/models');
   });
});
