import { Type, type Static } from '@sinclair/typebox';
import { ApiError } from './common.ts';

/**
 * Provider contracts.
 *
 * PLAN.MD §4.4: one **OpenAI-compatible** adapter with a user-editable base URL
 * covers Nous Portal, OpenRouter, OpenAI, Together, Groq, Ollama, LM Studio and
 * vLLM. Native Anthropic and Gemini adapters are additive (Phase 3) behind the
 * same interface, so `kind` exists from the start and has two members that are
 * not implemented yet. Naming them now keeps the stored config forward
 * compatible instead of requiring a migration later.
 *
 * **No API key appears anywhere in this file.** Keys live in the OS keychain on
 * the Flutter side (PLAN.MD §8) and are handed to the sidecar in memory. A key
 * on a response shape is a key in a log the first time someone debugs a route.
 */

export const ProviderKind = Type.Union(
   [Type.Literal('openai_compatible'), Type.Literal('anthropic'), Type.Literal('gemini')],
   { $id: 'ProviderKind', description: 'Which adapter drives this provider.' },
);

export type ProviderKindT = Static<typeof ProviderKind>;

export const Provider = Type.Object(
   {
      /** Stable key used by `Session.provider` and in config.toml. */
      id: Type.String({ minLength: 1, maxLength: 64 }),
      kind: ProviderKind,
      /** What the user calls it. Free text; shown in the model picker. */
      label: Type.String({ maxLength: 120 }),
      baseUrl: Type.String({ maxLength: 500 }),
      /** The model used when a session does not name one. */
      defaultModel: Type.String({ maxLength: 200 }),
      /**
       * Context window in tokens, as configured rather than discovered. Most
       * OpenAI-compatible endpoints do not report it, and guessing wrong is how
       * a conversation dies mid-turn, so the user owns this number.
       */
      contextWindow: Type.Integer({ minimum: 1024 }),
      maxTokens: Type.Integer({ minimum: 1 }),
      temperature: Type.Number({ minimum: 0, maximum: 2 }),
      supportsTools: Type.Boolean(),
      /** Whether a key is present in the keychain. Never the key itself. */
      hasKey: Type.Boolean(),
   },
   { $id: 'Provider', additionalProperties: false },
);

export type ProviderT = Static<typeof Provider>;

export const ProviderList = Type.Object(
   {
      providers: Type.Array(Provider),
      /** The id used when a request names no provider. */
      defaultProvider: Type.String({ maxLength: 64 }),
   },
   { $id: 'ProviderList', additionalProperties: false },
);

export type ProviderListT = Static<typeof ProviderList>;

export const ModelInfo = Type.Object(
   {
      id: Type.String({ maxLength: 200 }),
      /** Absent when the endpoint reports only an id, which most do. */
      label: Type.Optional(Type.String({ maxLength: 200 })),
   },
   { $id: 'ModelInfo', additionalProperties: false },
);

export type ModelInfoT = Static<typeof ModelInfo>;

export const ModelList = Type.Object(
   {
      models: Type.Array(ModelInfo),
      /**
       * True when the list came from the provider rather than from config.
       * An endpoint with no `/models` route is normal (vLLM, some proxies), and
       * the UI should offer a free-text field instead of an empty picker.
       */
      discovered: Type.Boolean(),
   },
   { $id: 'ModelList', additionalProperties: false },
);

export type ModelListT = Static<typeof ModelList>;

/**
 * The result of a credential check.
 *
 * Modelled as a success shape carrying `ok: false` rather than an HTTP error,
 * because a rejected key is an expected answer to "is this key good?" — not a
 * failure of the request. The UI renders it inline in settings.
 */
export const ProviderCheck = Type.Object(
   {
      ok: Type.Boolean(),
      /** Populated when `ok` is false. Safe to display. */
      error: Type.Optional(ApiError),
      /** Round-trip time in milliseconds, shown so a slow endpoint is visible. */
      latencyMs: Type.Optional(Type.Integer({ minimum: 0 })),
   },
   { $id: 'ProviderCheck', additionalProperties: false },
);

export type ProviderCheckT = Static<typeof ProviderCheck>;

/**
 * Hand a provider's API key to the sidecar for this run only.
 *
 * The key is held in memory, never written to `config.toml` and never logged.
 * The Flutter shell re-sends it after a sidecar restart, since the keychain is
 * on its side of the process boundary.
 */
export const SetCredentialRequest = Type.Object(
   {
      providerId: Type.String({ minLength: 1, maxLength: 64 }),
      /** Empty string clears the key for this run. */
      apiKey: Type.String({ maxLength: 8192 }),
   },
   { $id: 'SetCredentialRequest', additionalProperties: false },
);

export type SetCredentialRequestT = Static<typeof SetCredentialRequest>;
