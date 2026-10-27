/**
 * The shape of `~/.rudra/config.toml`.
 *
 * TOML was chosen over YAML deliberately (PLAN.MD §11.3): it is typed and
 * unambiguous, with no implicit casts to be surprised by. But a parser that
 * accepts any valid TOML still accepts `temperature = "hot"`, so the parsed
 * value is validated against this schema before anything reads it — the same
 * discipline applied to request bodies, for the same reason.
 *
 * **Keys are snake_case here and only here.** TOML convention is snake_case and
 * a config file a human edits should look like one; the wire contracts stay
 * camelCase. `server/src/config.ts` is the one place that crosses between them.
 *
 * **No API key appears in this schema.** Keys live in the OS keychain
 * (PLAN.MD §8). A config file is the first thing a user pastes into an issue.
 */

import { Type, type Static } from '@sinclair/typebox';

export const ProviderConfig = Type.Object(
   {
      kind: Type.Union(
         [Type.Literal('openai_compatible'), Type.Literal('anthropic'), Type.Literal('gemini')],
         { default: 'openai_compatible' },
      ),
      label: Type.String({ minLength: 1, maxLength: 120 }),
      base_url: Type.String({ minLength: 1, maxLength: 500 }),
      default_model: Type.String({ minLength: 1, maxLength: 200 }),
      /**
       * Configured, not discovered. Most OpenAI-compatible endpoints do not
       * report their window, and guessing wrong kills a conversation mid-turn,
       * so the user owns this number.
       */
      context_window: Type.Integer({ minimum: 1024, default: 128_000 }),
      max_tokens: Type.Integer({ minimum: 1, default: 4096 }),
      temperature: Type.Number({ minimum: 0, maximum: 2, default: 0.7 }),
      supports_tools: Type.Boolean({ default: true }),
      /**
       * Ask for token usage on the final streamed chunk. Off is for a strict
       * back end that rejects request fields it does not know.
       */
      include_usage: Type.Boolean({ default: true }),
   },
   { $id: 'ProviderConfig', additionalProperties: false },
);

export type ProviderConfigT = Static<typeof ProviderConfig>;

export const MemoryConfig = Type.Object(
   {
      /** PLAN.MD §5.4. Default false: writes apply immediately. */
      write_approval: Type.Boolean({ default: false }),
   },
   { $id: 'MemoryConfig', additionalProperties: false },
);

export const RudraConfig = Type.Object(
   {
      /** Must name a key of `providers`; checked after parsing, not by the schema. */
      default_provider: Type.String({ minLength: 1, maxLength: 64 }),
      providers: Type.Record(Type.String(), ProviderConfig),
      memory: Type.Optional(MemoryConfig),
   },
   { $id: 'RudraConfig', additionalProperties: false },
);

export type RudraConfigT = Static<typeof RudraConfig>;

/**
 * What a fresh install gets.
 *
 * Deliberately a *local* endpoint: a first run should do something useful
 * without a key, and someone evaluating this is far more likely to have Ollama
 * running than to want to paste a credential into a new app. Pointing at a paid
 * endpoint by default would also make a typo cost money.
 */
export const DEFAULT_CONFIG: RudraConfigT = {
   default_provider: 'ollama',
   providers: {
      ollama: {
         kind: 'openai_compatible',
         label: 'Ollama (local)',
         base_url: 'http://127.0.0.1:11434/v1',
         default_model: 'llama3.2',
         context_window: 8192,
         max_tokens: 2048,
         temperature: 0.7,
         supports_tools: true,
         include_usage: true,
      },
   },
   memory: { write_approval: false },
};

/** The commented file written on first run. Comments are why this is a string. */
export const DEFAULT_CONFIG_TOML = `# Rudra configuration.
#
# API keys do NOT live here. They are kept in the OS keychain, so this file is
# safe to share when you are asking for help.
#
# Every provider below speaks the OpenAI-compatible API, which covers Ollama,
# LM Studio, vLLM, OpenRouter, Together, Groq, Nous Portal and OpenAI itself.
# Add one by copying a block and changing base_url and default_model.

default_provider = "ollama"

[providers.ollama]
kind           = "openai_compatible"
label          = "Ollama (local)"
base_url       = "http://127.0.0.1:11434/v1"
default_model  = "llama3.2"
context_window = 8192
max_tokens     = 2048
temperature    = 0.7
supports_tools = true
# Ask for token counts on the last streamed chunk. Turn off for a strict
# back end that rejects request fields it does not recognise.
include_usage  = true

# [providers.openai]
# kind           = "openai_compatible"
# label          = "OpenAI"
# base_url       = "https://api.openai.com/v1"
# default_model  = "gpt-4o"
# context_window = 128000
# max_tokens     = 4096
# temperature    = 0.7
# supports_tools = true
# include_usage  = true

[memory]
# When true, memory writes are staged and reviewed in the GUI before they
# apply (PLAN.MD §5.4).
write_approval = false
`;
