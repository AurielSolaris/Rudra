/**
 * Migrations for `main.db`. **`cache.db` is never migrated** (PLAN.MD §6) — on
 * a schema mismatch it is dropped and recreated, which is why `rm cache.db` is
 * always a safe recovery step (INVARIANT 7).
 *
 * Progress is tracked in SQLite's own `user_version` pragma rather than a table
 * of our own. It is an integer in the database header, it costs nothing to
 * read, and it cannot itself get out of step with the schema it describes.
 *
 * Two rules this module enforces, both of which exist because the alternative
 * leaves a user with a half-built database and no good options:
 *
 *  1. **One migration, one transaction.** A statement that fails rolls the
 *     whole file back to the version it had.
 *  2. **Never skip, never reorder.** Files are applied in filename order, and a
 *     gap or a duplicate number is refused rather than guessed at.
 *
 * Migration SQL lives in `packages/db/migrations/` and is hand-authored. See
 * `docs/decisions/0004-migrations.md`.
 */

import { type Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@rudra/shared/logger';

const log = createLogger('migrate');

const MIGRATIONS_DIR = join(import.meta.dir, '../migrations');

/** `0003_add_thing.sql` -> 3. Anything else is not a migration. */
const FILENAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migration {
   readonly version: number;
   readonly name: string;
   readonly sql: string;
}

/**
 * Read the migration set from disk, in order.
 *
 * Exported so a test can assert the set is well-formed without applying it.
 */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
   const found: Migration[] = [];

   for (const name of readdirSync(dir).sort()) {
      const match = FILENAME.exec(name);
      if (match === null) {
         if (name.endsWith('.sql')) {
            throw new Error(
               `Migration ${JSON.stringify(name)} is misnamed. Expected NNNN_lower_snake.sql`,
            );
         }
         continue;
      }
      // `match[1]` is the digits group; the regex cannot match without it, but
      // `noUncheckedIndexedAccess` is right that the type does not say so.
      const digits = match[1];
      if (digits === undefined) continue;

      found.push({
         version: Number.parseInt(digits, 10),
         name,
         sql: readFileSync(join(dir, name), 'utf8'),
      });
   }

   // Contiguous from 1. A gap means a file was lost, and applying what remains
   // would produce a schema no version number describes.
   found.forEach((migration, i) => {
      const expected = i + 1;
      if (migration.version !== expected) {
         throw new Error(
            `Migrations must be numbered contiguously from 0001. ` +
               `Expected ${String(expected).padStart(4, '0')}, found ${migration.name}.`,
         );
      }
   });

   return found;
}

export interface MigrateResult {
   readonly from: number;
   readonly to: number;
   readonly applied: readonly string[];
}

/** Bring `db` up to the latest version. Idempotent. */
export function migrate(db: Database, dir: string = MIGRATIONS_DIR): MigrateResult {
   const migrations = loadMigrations(dir);
   const current = userVersion(db);
   const latest = migrations.length;

   if (current > latest) {
      // The file was written by a newer build. Migrating down is not something
      // we can do correctly, and opening it anyway risks writing rows the older
      // schema cannot represent.
      throw new Error(
         `main.db is at version ${current} but this build only knows ${latest}. ` +
            'It was written by a newer version of Rudra.',
      );
   }

   const applied: string[] = [];
   for (const migration of migrations) {
      if (migration.version <= current) continue;

      // One transaction per migration. `user_version` is set inside it, so the
      // version and the schema it describes commit together or not at all.
      db.transaction(() => {
         db.run(migration.sql);
         // Pragmas do not accept bound parameters; the value is an integer we
         // parsed from a filename matched against FILENAME, not user input.
         db.run(`PRAGMA user_version = ${migration.version}`);
      })();

      applied.push(migration.name);
      log.info('applied migration', { name: migration.name });
   }

   return { from: current, to: latest, applied };
}

export function userVersion(db: Database): number {
   const row = db.query('PRAGMA user_version').get() as { user_version?: number } | null;
   return row?.user_version ?? 0;
}

/** The version this build expects. Used by the cache's drop-on-mismatch check. */
export function latestVersion(dir: string = MIGRATIONS_DIR): number {
   return loadMigrations(dir).length;
}
