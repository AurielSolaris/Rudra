/**
 * The one interface every provider adapter meets.
 *
 * PLAN.MD §4.4: the OpenAI-compatible adapter covers Nous Portal, OpenRouter,
 * OpenAI, Together, Groq, Ollama, LM Studio and vLLM. Anthropic and Gemini get
 * native adapters in Phase 3 behind this same interface, which is why nothing
 * here leaks an OpenAI-shaped concept — no `choices`, no `delta`, no
 * `finish_reason` spelled their way.
 *
 * **Streaming is an `AsyncGenerator`, not a callback.** Cancellation then comes
 * for free: when the consumer stops pulling, the generator's `finally` runs,
 * the upstream request is aborted, and the partial message is persisted as
 * `interrupted` (PLAN.MD §7). A callback API would need its own cancellation
 * protocol, and that protocol is where interrupt bugs live.
 */

import type { ModelInfoT, ProviderKindT } from '@rudra/contracts';
import type { Result } from '@rudra/shared/result';

/** One turn in the conversation as a provider sees it. */
export interface ProviderMessage {
   readonly role: 'system' | 'user' | 'assistant' | 'tool';
   readonly content: string;
}

export interface CompletionRequest {
   readonly model: string;
   readonly messages: readonly ProviderMessage[];
   readonly temperature?: number;
   readonly maxTokens?: number;
   /**
    * Aborts the upstream HTTP request. Separate from simply stopping iteration
    * because the socket must close even if the consumer is wedged.
    */
   readonly signal?: AbortSignal;
}

/**
 * Why generation stopped, in our vocabulary rather than any provider's.
 *
 * `interrupted` is absent on purpose: it is not something a provider reports,
 * it is something *we* conclude when the consumer stopped pulling. The agent
 * loop owns that word.
 */
export type ProviderStopReason = 'complete' | 'length' | 'tool_calls';

export type ProviderEvent =
   | { readonly type: 'delta'; readonly text: string }
   /**
    * Token accounting, if the provider volunteers it. Many OpenAI-compatible
    * endpoints omit usage on a streamed response, so this may never arrive —
    * which is why the contract's token fields are optional rather than zero.
    * A fabricated estimate in a field the UI shows as a cost is worse than a
    * blank.
    */
   | { readonly type: 'usage'; readonly tokensIn?: number; readonly tokensOut?: number }
   | { readonly type: 'done'; readonly reason: ProviderStopReason };

/**
 * What a provider needs to make a call, assembled per request.
 *
 * The key is passed in rather than held by the adapter, so an adapter instance
 * never owns a credential and cannot leak one through its own state.
 */
export interface ProviderCredentials {
   readonly apiKey?: string;
}

export interface ProviderAdapter {
   readonly id: string;
   readonly kind: ProviderKindT;

   /**
    * Stream a completion.
    *
    * Yields zero or more `delta`s, an optional `usage`, then exactly one
    * `done` — unless it throws, which is reserved for a genuine upstream
    * failure the caller should surface as `StreamError`.
    */
   stream(
      request: CompletionRequest,
      credentials: ProviderCredentials,
   ): AsyncGenerator<ProviderEvent>;

   /**
    * Ask the endpoint what models it serves.
    *
    * An endpoint with no model route is normal (vLLM, several proxies), so a
    * failure here is informational: the UI falls back to a free-text field
    * rather than showing an error.
    */
   listModels(credentials: ProviderCredentials): Promise<Result<ModelInfoT[]>>;
}
