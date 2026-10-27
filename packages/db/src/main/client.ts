/**
 * `main.db` — durable, migrated, the thing a backup would take (PLAN.MD §6).
 *
 * The pragmas here are the durability contract, and each one is a decision:
 *
 * - **`journal_mode = WAL`** — a reader never blocks the writer. The UI pages
 *   history while a stream is being flushed into it every 250 ms, and under the
 *   rollback journal that is a lock fight.
 * - **`synchronous = NORMAL`** — with WAL this is the documented safe setting:
 *   durable against a *process* crash, which is the case autosave is written
 *   for. FULL would fsync on every commit, i.e. four times a second during a
 *   stream, to additionally survive a power cut mid-commit. That is not the
 *   trade a desktop chat app should make.
 * - **`foreign_keys = ON`** — SQLite defaults it OFF per connection. Without it
 *   the `ON DELETE CASCADE` on messages is decoration, and deleting a session
 *   silently orphans its transcript.
 * - **`busy_timeout`** — one writer, but WAL checkpointing and the occasional
 *   second connection in tests can still collide. Failing instantly with
 *   SQLITE_BUSY would turn a 5 ms wait into a visible error.
 */

import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { sql } from 'drizzle-orm';
import { createLogger } from '@rudra/shared/logger';
import { dbPath, ensureProfileLayout } from '@rudra/shared/paths';
import { migrate } from '../migrate.ts';
import * as schema from './schema.ts';

const log = createLogger('db:main');

const BUSY_TIMEOUT_MS = 5_000;

export type MainDb = BunSQLiteDatabase<typeof schema> & { $client: Database };

export interface OpenMainOptions {
   /** Override the path. Tests pass `:memory:`; the app never passes this. */
   path?: string;
   profileId?: string;
   /** Skip migrations. Only a migration test has any business doing this. */
   skipMigrations?: boolean;
}

export interface OpenedMain {
   readonly db: MainDb;
   readonly raw: Database;
   readonly path: string;
   /** Flush the WAL back into the main file and close. Safe to call twice. */
   readonly close: () => void;
}

export function openMain(options: OpenMainOptions = {}): OpenedMain {
   let path = options.path;
   if (path === undefined) {
      ensureProfileLayout(options.profileId);
      path = dbPath('main', options.profileId);
   }

   const raw = new Database(path, { create: true, readwrite: true });

   // An in-memory database has no WAL to speak of, and asking for one is not an
   // error but is noise. Everything else applies to both.
   if (path !== ':memory:') raw.run('PRAGMA journal_mode = WAL');
   raw.run('PRAGMA synchronous = NORMAL');
   raw.run('PRAGMA foreign_keys = ON');
   raw.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

   if (options.skipMigrations !== true) {
      const result = migrate(raw);
      if (result.applied.length > 0) {
         log.info('migrated main.db', { from: result.from, to: result.to });
      }
   }

   const db = drizzle<typeof schema>(raw, { schema });

   let closed = false;
   const close = (): void => {
      if (closed) return;
      closed = true;
      try {
         // Fold the WAL back in, so the file on disk is complete and a copy of
         // it is a real backup rather than a torso needing its -wal sidecar.
         if (path !== ':memory:') raw.run('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (cause) {
         log.exception('wal checkpoint failed on close', cause);
      }
      raw.close();
   };

   return { db, raw, path, close };
}

/**
 * Repair messages left mid-stream by a crash.
 *
 * INVARIANT 6: a partial message is never presented as a complete one. A row
 * whose `finish_reason` is still NULL at startup is one nobody is writing any
 * more — the only process that could have been died. Marking it `interrupted`
 * is what makes the partial text honest in the UI.
 *
 * Returns how many rows were repaired, so boot can log a number rather than a
 * shrug.
 */
export function markDanglingAsInterrupted(db: MainDb): number {
   // Counted by selecting first rather than from an update's row count: the
   // driver's `.run()` reports nothing, and boot should be able to log a
   // number rather than a shrug. One extra read, once, at startup.
   const dangling = sql`${schema.messages.finishReason} IS NULL AND ${schema.messages.role} = 'assistant'`;

   const found = db.select({ id: schema.messages.id }).from(schema.messages).where(dangling).all();

   if (found.length === 0) return 0;

   db.update(schema.messages).set({ finishReason: 'interrupted' }).where(dangling).run();

   log.warn('repaired messages left mid-stream', { count: found.length });
   return found.length;
}

export { schema };
