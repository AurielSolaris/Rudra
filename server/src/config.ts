/**
 * Load `~/.rudra/config.toml`.
 *
 * Parsing is `Bun.TOML.parse`, so TOML costs no dependency. Validation is
 * TypeBox against `config_schema.ts`, because a parser that accepts valid TOML
 * still accepts `temperature = "hot"`.
 *
 * **A broken config never stops the app from starting.** The sidecar is how the
 * user reaches the settings UI that would let them fix it, so refusing to boot
 * over a malformed file is a trap with no way out. A bad file falls back to the
 * defaults and the problem is reported as a value — `ConfigLoad.problems` — for
 * the UI to surface. That is the opposite of how a request body is treated, and
 * deliberately so: a bad request has a caller to tell, a bad config has a user
 * who needs the app running to repair it.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import { createLogger } from '@rudra/shared/logger';
import { configPath, ensureProfileLayout } from '@rudra/shared/paths';
import {
   DEFAULT_CONFIG,
   DEFAULT_CONFIG_TOML,
   ProviderConfig,
   RudraConfig,
   type RudraConfigT,
} from '@rudra/shared/config_schema';

const log = createLogger('config');

export interface ConfigLoad {
   readonly config: RudraConfigT;
   readonly path: string;
   /** True when the file was absent and has just been written. */
   readonly created: boolean;
   /**
    * Why the file on disk was not used, if it was not. Empty on a clean load.
    * Surfaced in the UI rather than thrown, so a typo is fixable from inside
    * the app.
    */
   readonly problems: readonly string[];
}

/**
 * Apply each provider's schema defaults, which `Value.Default` skips because
 * `providers` is a `Type.Record` and it does not descend into record values.
 *
 * Shapes that are not objects are returned untouched — validation will reject
 * them in a moment with a message naming the path, which is more useful than
 * anything this function could say.
 */
function defaultProviders(parsed: unknown): unknown {
   if (typeof parsed !== 'object' || parsed === null) return parsed;

   const root = parsed as Record<string, unknown>;
   const providers = root['providers'];
   if (typeof providers !== 'object' || providers === null) return parsed;

   const defaulted: Record<string, unknown> = {};
   for (const [id, entry] of Object.entries(providers as Record<string, unknown>)) {
      defaulted[id] =
         typeof entry === 'object' && entry !== null ? Value.Default(ProviderConfig, entry) : entry;
   }

   return { ...root, providers: defaulted };
}

/** Parse and validate TOML text. Exported so a test needs no filesystem. */
export function parseConfig(text: string): {
   config: RudraConfigT;
   problems: string[];
} {
   const problems: string[] = [];

   let parsed: unknown;
   try {
      parsed = Bun.TOML.parse(text);
   } catch (cause) {
      problems.push(
         `config.toml is not valid TOML: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return { config: DEFAULT_CONFIG, problems };
   }

   // Fill in anything the user left out before validating, so an omitted
   // knob is a default rather than an error. A config file should not have to
   // restate every option to be valid.
   //
   // `providers` is a Record, and `Value.Default` does not descend into a
   // record's values — so each provider is defaulted explicitly before the
   // whole document is. Without this, every optional field would read as a
   // missing required one.
   const withDefaults = Value.Default(RudraConfig, defaultProviders(parsed));

   if (!Value.Check(RudraConfig, withDefaults)) {
      for (const error of Value.Errors(RudraConfig, withDefaults)) {
         problems.push(`${error.path === '' ? '(root)' : error.path}: ${error.message}`);
      }
      return { config: DEFAULT_CONFIG, problems };
   }

   const config: RudraConfigT = withDefaults;

   // The schema cannot express "this string names one of those keys", and a
   // default_provider pointing at nothing is the single most likely mistake in
   // a hand-edited file.
   if (!Object.hasOwn(config.providers, config.default_provider)) {
      // Destructured with a guard rather than indexed: `noUncheckedIndexedAccess`
      // is right that a length check does not narrow `names[0]`.
      const [fallback] = Object.keys(config.providers);
      if (fallback === undefined) {
         problems.push('config.toml defines no providers.');
         return { config: DEFAULT_CONFIG, problems };
      }
      const names = Object.keys(config.providers);
      problems.push(
         `default_provider "${config.default_provider}" is not one of the configured ` +
            `providers (${names.join(', ')}); using "${fallback}".`,
      );
      return { config: { ...config, default_provider: fallback }, problems };
   }

   return { config, problems };
}

/**
 * Read the config, writing a commented default file if there is none.
 *
 * Writing on first run is what makes the file discoverable: a user who has
 * never seen it can open it and find every option already named.
 */
export function loadConfig(path: string = configPath()): ConfigLoad {
   if (!existsSync(path)) {
      ensureProfileLayout();
      try {
         writeFileSync(path, DEFAULT_CONFIG_TOML, 'utf8');
         log.info('wrote a default config', { path });
         return { config: DEFAULT_CONFIG, path, created: true, problems: [] };
      } catch (cause) {
         // A read-only home is survivable: run on the defaults and say so.
         log.exception('could not write the default config', cause);
         return {
            config: DEFAULT_CONFIG,
            path,
            created: false,
            problems: ['Could not write a default config.toml; using built-in defaults.'],
         };
      }
   }

   let text: string;
   try {
      text = readFileSync(path, 'utf8');
   } catch (cause) {
      log.exception('could not read config', cause);
      return {
         config: DEFAULT_CONFIG,
         path,
         created: false,
         problems: ['Could not read config.toml; using built-in defaults.'],
      };
   }

   const { config, problems } = parseConfig(text);
   for (const problem of problems) log.warn('config problem', { problem });

   return { config, path, created: false, problems };
}
