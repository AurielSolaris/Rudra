/**
 * Every filesystem path Rudra uses resolves here.
 *
 * INVARIANT 15 (MAP.txt): all paths go through `profileRoot()`. v1 ships a
 * single profile, but multi-profile is deferred rather than precluded
 * (PLAN.MD §11.4) — so no module may build a path from `homedir()` itself. The
 * day profiles land, this file changes and nothing else does.
 */

import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { mkdirSync } from 'node:fs';

export const DEFAULT_PROFILE = 'default';

/** A profile id must be a safe single path segment. */
const SAFE_PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidProfileId(id: string): boolean {
   return SAFE_PROFILE.test(id);
}

/**
 * The Rudra home directory.
 *
 * `RUDRA_HOME` wins when set (tests always set it, so a test run can never
 * touch a real profile). Otherwise: `%LOCALAPPDATA%\rudra` on Windows, where
 * dotfolders in the user profile are not the convention, and `~/.rudra`
 * elsewhere.
 */
export function rudraHome(): string {
   const override = globalThis.process.env['RUDRA_HOME'];
   if (override && override.trim() !== '') return resolve(override);

   if (globalThis.process.platform === 'win32') {
      const localAppData = globalThis.process.env['LOCALAPPDATA'];
      if (localAppData && localAppData.trim() !== '') return join(localAppData, 'rudra');
   }
   return join(homedir(), '.rudra');
}

/**
 * The root for one profile. Everything user-scoped hangs off this.
 *
 * The default profile lives directly in the home directory (so a v1 install
 * looks like `~/.rudra/memories/MEMORY.md`, exactly as PLAN.MD §5.1 documents),
 * while any named profile nests under `profiles/<id>/`. That keeps the v1
 * layout clean *and* leaves room for profiles without moving a single file.
 */
export function profileRoot(profileId: string = DEFAULT_PROFILE): string {
   if (profileId === DEFAULT_PROFILE) return rudraHome();
   if (!isValidProfileId(profileId)) {
      throw new Error(`Invalid profile id: ${JSON.stringify(profileId)}`);
   }
   return join(rudraHome(), 'profiles', profileId);
}

export function memoriesDir(profileId?: string): string {
   return join(profileRoot(profileId), 'memories');
}

/** PLAN.MD §5.1 — the two curated stores. */
export function memoryFile(store: 'memory' | 'user', profileId?: string): string {
   return join(memoriesDir(profileId), store === 'memory' ? 'MEMORY.md' : 'USER.md');
}

/** PLAN.MD §6 — two databases, split for durability and disposability. */
export function dbPath(which: 'main' | 'cache', profileId?: string): string {
   return join(profileRoot(profileId), `${which}.db`);
}

/** PLAN.MD §11.3 — TOML config. Not profile-scoped: it configures the app. */
export function configPath(): string {
   return join(rudraHome(), 'config.toml');
}

export function logsDir(): string {
   return join(rudraHome(), 'logs');
}

/** Scratch space for spilled tool output and headless render temp files. */
export function scratchDir(profileId?: string): string {
   return join(profileRoot(profileId), 'scratch');
}

export function ensureDir(path: string): string {
   mkdirSync(path, { recursive: true });
   return path;
}

/** Create the directories a profile needs. Idempotent. */
export function ensureProfileLayout(profileId?: string): void {
   ensureDir(profileRoot(profileId));
   ensureDir(memoriesDir(profileId));
   ensureDir(scratchDir(profileId));
   ensureDir(logsDir());
}

/**
 * Is `child` inside `parent`?
 *
 * The containment check behind the filesystem allowlist (PLAN.MD §8). Compares
 * resolved paths with a trailing separator so `/home/user-backup` is not
 * treated as inside `/home/user`. Case-insensitive on Windows.
 *
 * NOTE: this is a *lexical* check. The Phase 3 allowlist must also resolve
 * symlinks (`realpath`) before calling it, or a link inside an allowed root can
 * still point outside one.
 */
export function isInside(parent: string, child: string): boolean {
   const normalize = (p: string): string => {
      const r = resolve(p);
      return globalThis.process.platform === 'win32' ? r.toLowerCase() : r;
   };
   const p = normalize(parent);
   const c = normalize(child);
   if (c === p) return true;
   return c.startsWith(p.endsWith(sep) ? p : p + sep);
}
