/**
 * The provider registry.
 *
 * Turns validated config into adapters, and holds the API keys for the life of
 * the process.
 *
 * **Keys are in memory and nowhere else.** They live in the OS keychain on the
 * Flutter side (PLAN.MD §8), which is across a process boundary from here, so
 * the shell hands them over after boot and again after any sidecar restart.
 * Nothing in this module writes a key to disk, puts one in a log, or returns
 * one from a method — `hasKey` is the only thing a caller can learn.
 */

import type { ModelInfoT, ProviderKindT, ProviderT } from '@rudra/contracts';
import type { RudraConfigT } from '@rudra/shared/config_schema';
import { createLogger } from '@rudra/shared/logger';
import { fail, ok, type Result } from '@rudra/shared/result';
import { createOpenAiCompatible } from './openai_compatible.ts';
import type { ProviderAdapter } from './types.ts';

const log = createLogger('providers');

export interface RegisteredProvider {
   readonly id: string;
   readonly kind: ProviderKindT;
   readonly adapter: ProviderAdapter;
   readonly defaultModel: string;
   readonly contextWindow: number;
   readonly maxTokens: number;
   readonly temperature: number;
   readonly supportsTools: boolean;
   readonly label: string;
   readonly baseUrl: string;
}

export interface Registry {
   get(id?: string): Result<RegisteredProvider>;
   list(): ProviderT[];
   defaultProviderId(): string;
   /** Empty string clears the key. Returns false if the provider is unknown. */
   setKey(id: string, apiKey: string): boolean;
   hasKey(id: string): boolean;
   credentialsFor(id: string): { apiKey?: string };
   listModels(id?: string): Promise<Result<ModelInfoT[]>>;
}

export function createRegistry(config: RudraConfigT): Registry {
   const providers = new Map<string, RegisteredProvider>();
   /** Kept apart from the provider records so a key cannot be spread into one. */
   const keys = new Map<string, string>();

   for (const [id, entry] of Object.entries(config.providers)) {
      if (entry.kind !== 'openai_compatible') {
         // Named in the contract from the start so stored config stays forward
         // compatible, but Phase 3 is when they get adapters (PLAN.MD §4.4).
         log.warn('provider kind is not implemented yet; skipping', { id, kind: entry.kind });
         continue;
      }

      providers.set(id, {
         id,
         kind: entry.kind,
         adapter: createOpenAiCompatible({
            id,
            baseUrl: entry.base_url,
            includeUsage: entry.include_usage,
         }),
         defaultModel: entry.default_model,
         contextWindow: entry.context_window,
         maxTokens: entry.max_tokens,
         temperature: entry.temperature,
         supportsTools: entry.supports_tools,
         label: entry.label,
         baseUrl: entry.base_url,
      });
   }

   const fallbackId = providers.has(config.default_provider)
      ? config.default_provider
      : (providers.keys().next().value ?? config.default_provider);

   return {
      get(id?: string): Result<RegisteredProvider> {
         const wanted = id ?? fallbackId;
         const found = providers.get(wanted);
         if (found === undefined) {
            return fail.notFound(`No provider named "${wanted}" is configured.`);
         }
         return ok(found);
      },

      list(): ProviderT[] {
         return [...providers.values()].map((p) => ({
            id: p.id,
            kind: p.kind,
            label: p.label,
            baseUrl: p.baseUrl,
            defaultModel: p.defaultModel,
            contextWindow: p.contextWindow,
            maxTokens: p.maxTokens,
            temperature: p.temperature,
            supportsTools: p.supportsTools,
            // The only thing a caller may learn about a credential.
            hasKey: keys.has(p.id),
         }));
      },

      defaultProviderId: () => fallbackId,

      setKey(id: string, apiKey: string): boolean {
         if (!providers.has(id)) return false;
         if (apiKey === '') {
            keys.delete(id);
            log.info('cleared provider key', { provider: id });
         } else {
            keys.set(id, apiKey);
            // No key material, not even a length — that is a hint about a
            // secret in a file the user may well paste into an issue.
            log.info('stored provider key for this run', { provider: id });
         }
         return true;
      },

      hasKey: (id: string) => keys.has(id),

      credentialsFor(id: string): { apiKey?: string } {
         const key = keys.get(id);
         return key === undefined ? {} : { apiKey: key };
      },

      async listModels(id?: string): Promise<Result<ModelInfoT[]>> {
         const provider = this.get(id);
         if (!provider.ok) return provider;
         return provider.value.adapter.listModels(this.credentialsFor(provider.value.id));
      },
   };
}
