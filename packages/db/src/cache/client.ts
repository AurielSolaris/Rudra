/**
 * `cache.db` — disposable, unmigrated (PLAN.MD §6).
 *
 * Opposite settings to `main.db`, for opposite reasons:
 *
 * - **`synchronous = OFF`** — losing this file to a power cut costs a
 *   recomputation, so paying fsync for it would be paying for nothing. This is
 *   only defensible because INVARIANT 7 holds: nothing here is the only copy.
 * - **No migrations.** On a schema mismatch the file is deleted and rebuilt.
 *   Migrating a cache is work in exchange for keeping data we are happy to
 *   throw away.
 *
 * The drop is deliberately whole-file rather than per-table: a partial rebuild
 * is how you end up with a cache that half-matches the code.
 */

import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { rmSync } from 'node:fs';
import { createLogger } from '@rudra/shared/logger';
import { dbPath, ensureProfileLayout } from '@rudra/shared/paths';
import * as schema from './schema.ts';
import { CACHE_SCHEMA_VERSION } from './schema.ts';

const log = createLogger('db:cache');

export type CacheDb = BunSQLiteDatabase<typeof schema> & { $client: Database };

export interface OpenCacheOptions {
   path?: string;
   profileId?: string;
}

export interface OpenedCache {
   readonly db: CacheDb;
   readonly raw: Database;
   readonly path: string;
   /** True when a stale file was discarded on open. */
   readonly rebuilt: boolean;
   readonly close: () => void;
}

/** The whole cache schema, as CREATE IF NOT EXISTS. Cheap enough to run always. */
const CREATE = `
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, from_seq INTEGER NOT NULL,
  to_seq INTEGER NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS summaries_session ON summaries (session_id, from_seq);

CREATE TABLE IF NOT EXISTS tool_result_cache (
  key TEXT PRIMARY KEY, tool TEXT NOT NULL, result TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS tool_result_expiry ON tool_result_cache (expires_at);

CREATE TABLE IF NOT EXISTS token_counts (
  key TEXT PRIMARY KEY, model TEXT NOT NULL, tokens INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS provider_models (
  provider_id TEXT PRIMARY KEY, models TEXT NOT NULL, fetched_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS diagram_cache (
  key TEXT PRIMARY KEY, svg TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
`;

function versionOf(db: Database): number {
   const row = db.query('PRAGMA user_version').get() as { user_version?: number } | null;
   return row?.user_version ?? 0;
}

export function openCache(options: OpenCacheOptions = {}): OpenedCache {
   let path = options.path;
   if (path === undefined) {
      ensureProfileLayout(options.profileId);
      path = dbPath('cache', options.profileId);
   }
   const onDisk = path !== ':memory:';

   let raw = new Database(path, { create: true, readwrite: true });
   let rebuilt = false;

   const stamped = versionOf(raw);
   // 0 means a file we just created; anything else that disagrees is stale.
   if (onDisk && stamped !== 0 && stamped !== CACHE_SCHEMA_VERSION) {
      log.info('cache schema changed; discarding', {
         found: stamped,
         expected: CACHE_SCHEMA_VERSION,
      });
      raw.close();
      // The sidecars go too, or SQLite reopens onto a WAL describing a file
      // that no longer exists.
      for (const suffix of ['', '-wal', '-shm']) {
         rmSync(`${path}${suffix}`, { force: true });
      }
      raw = new Database(path, { create: true, readwrite: true });
      rebuilt = true;
   }

   if (onDisk) raw.run('PRAGMA journal_mode = WAL');
   raw.run('PRAGMA synchronous = OFF');
   raw.run(`PRAGMA user_version = ${CACHE_SCHEMA_VERSION}`);
   raw.run(CREATE);

   const db = drizzle<typeof schema>(raw, { schema });

   let closed = false;
   const close = (): void => {
      if (closed) return;
      closed = true;
      raw.close();
   };

   return { db, raw, path, rebuilt, close };
}

export { schema, CACHE_SCHEMA_VERSION };
