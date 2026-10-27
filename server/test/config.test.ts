/**
 * Config loading.
 *
 * The property under test throughout: **a bad config never stops the app from
 * starting.** The sidecar is how the user reaches the settings UI that would
 * let them fix the file, so refusing to boot over a typo is a trap with no way
 * out. Every malformed input below has to produce a working config plus a
 * reported problem, never a throw.
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG_TOML } from '@rudra/shared/config_schema';
import { loadConfig, parseConfig } from '../src/config.ts';

const temps: string[] = [];

function tempDir(): string {
   const dir = mkdtempSync(join(tmpdir(), 'rudra-config-'));
   temps.push(dir);
   return dir;
}

afterEach(() => {
   while (temps.length > 0) {
      const dir = temps.pop();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
   }
});

const VALID = `
default_provider = "local"

[providers.local]
kind = "openai_compatible"
label = "Local"
base_url = "http://127.0.0.1:11434/v1"
default_model = "llama3.2"
context_window = 8192
max_tokens = 2048
temperature = 0.5
supports_tools = true
include_usage = true
`;

describe('a valid config is read as written', () => {
   it('keeps every value', () => {
      const { config, problems } = parseConfig(VALID);
      expect(problems).toEqual([]);
      expect(config.default_provider).toBe('local');
      expect(config.providers['local']?.temperature).toBe(0.5);
      expect(config.providers['local']?.context_window).toBe(8192);
   });

   it('fills in omitted optionals rather than refusing the file', () => {
      // A config file should not have to restate every knob to be valid.
      const sparse = `
default_provider = "local"

[providers.local]
kind = "openai_compatible"
label = "Local"
base_url = "http://127.0.0.1:11434/v1"
default_model = "llama3.2"
`;
      const { config, problems } = parseConfig(sparse);
      expect(problems).toEqual([]);
      expect(config.providers['local']?.max_tokens).toBeGreaterThan(0);
      expect(config.providers['local']?.temperature).toBeGreaterThanOrEqual(0);
   });

   it('parses the default file we ship', () => {
      // The commented file written on first run has to be valid, or a fresh
      // install starts by reporting a problem with its own defaults.
      const { config, problems } = parseConfig(DEFAULT_CONFIG_TOML);
      expect(problems).toEqual([]);
      expect(Object.keys(config.providers).length).toBeGreaterThan(0);
      expect(config.providers[config.default_provider]).toBeDefined();
   });
});

describe('a broken config degrades instead of throwing', () => {
   it('survives TOML that does not parse', () => {
      const { config, problems } = parseConfig('this is not = = toml [[[');
      expect(problems.length).toBeGreaterThan(0);
      expect(Object.keys(config.providers).length).toBeGreaterThan(0);
   });

   it('survives a value of the wrong type', () => {
      const broken = VALID.replace('temperature = 0.5', 'temperature = "hot"');
      const { config, problems } = parseConfig(broken);
      // TOML is typed, so this is valid TOML and invalid config — exactly what
      // the schema pass is for.
      expect(problems.length).toBeGreaterThan(0);
      expect(Object.keys(config.providers).length).toBeGreaterThan(0);
   });

   it('reports a temperature outside the allowed range', () => {
      const { problems } = parseConfig(VALID.replace('temperature = 0.5', 'temperature = 11'));
      expect(problems.length).toBeGreaterThan(0);
   });

   it('falls back when default_provider names nothing', () => {
      // The single most likely mistake in a hand-edited file.
      const { config, problems } = parseConfig(
         VALID.replace('default_provider = "local"', 'default_provider = "typo"'),
      );
      expect(problems.join(' ')).toContain('typo');
      expect(config.default_provider).toBe('local');
   });

   it('falls back when no providers are configured at all', () => {
      const { config, problems } = parseConfig('default_provider = "x"\n[providers]\n');
      expect(problems.length).toBeGreaterThan(0);
      expect(config.providers[config.default_provider]).toBeDefined();
   });
});

describe('the file on disk', () => {
   it('is written, commented, on first run', () => {
      // Writing it is what makes the file discoverable: a user who has never
      // seen one can open it and find every option already named.
      const path = join(tempDir(), 'config.toml');
      const loaded = loadConfig(path);

      expect(loaded.created).toBe(true);
      expect(loaded.problems).toEqual([]);
      expect(existsSync(path)).toBe(true);

      const written = readFileSync(path, 'utf8');
      expect(written).toContain('#');
      // The comment that matters most: keys are not kept here.
      expect(written).toMatch(/keys do NOT live here/i);
   });

   it('is not overwritten on a later run', () => {
      const path = join(tempDir(), 'config.toml');
      writeFileSync(path, VALID, 'utf8');

      const loaded = loadConfig(path);
      expect(loaded.created).toBe(false);
      expect(loaded.config.default_provider).toBe('local');
      expect(readFileSync(path, 'utf8')).toBe(VALID);
   });

   it('never contains an api key field', () => {
      // PLAN.MD §8. A config file is the first thing a user pastes into an issue.
      expect(DEFAULT_CONFIG_TOML).not.toMatch(/api_key|apikey|secret\s*=/i);
   });
});
