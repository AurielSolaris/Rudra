/**
 * Data-layer tests.
 *
 * Two things are being defended here, both structural rather than behavioural:
 *
 *  1. **The Drizzle schema and the migration SQL do not drift.** The SQL is the
 *     source of truth for what is on disk; `schema.ts` is a typed view of it.
 *     Nothing but a test reflecting over the real database keeps the two
 *     honest, so that is what the first group does.
 *  2. **The invariants from PLAN.MD §6 hold on a real file** — cascade delete,
 *     the interrupted-message repair (INVARIANT 6), and cache disposability
 *     (INVARIANT 7).
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { newId } from '@rudra/shared/ids';
import { openMain, markDanglingAsInterrupted, schema } from '../src/main/client.ts';
import { openCache } from '../src/cache/client.ts';
import { loadMigrations, migrate, userVersion } from '../src/migrate.ts';

const temps: string[] = [];

function tempDir(): string {
   const dir = mkdtempSync(join(tmpdir(), 'rudra-db-'));
   temps.push(dir);
   return dir;
}

afterEach(() => {
   while (temps.length > 0) {
      const dir = temps.pop();
      if (dir === undefined) continue;
      try {
         rmSync(dir, { recursive: true, force: true });
      } catch {
         // Windows holds a briefly-lingering handle on a just-closed SQLite
         // file. The directory is under the OS temp dir either way; failing
         // cleanup must not fail the suite.
      }
   }
});

/** Column names SQLite actually has for a table. */
function columnsOf(db: Database, table: string): Set<string> {
   const rows = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
   return new Set(rows.map((r) => r.name));
}

describe('migrations', () => {
   it('are contiguous and well named', () => {
      const migrations = loadMigrations();
      expect(migrations.length).toBeGreaterThan(0);
      migrations.forEach((m, i) => {
         expect(m.version).toBe(i + 1);
      });
   });

   it('are idempotent — running twice changes nothing', () => {
      const db = new Database(':memory:');
      const first = migrate(db);
      expect(first.applied.length).toBeGreaterThan(0);

      const second = migrate(db);
      expect(second.applied).toEqual([]);
      expect(userVersion(db)).toBe(first.to);
      db.close();
   });

   it('refuse a database written by a newer build', () => {
      // Migrating down cannot be done correctly, and opening anyway risks
      // writing rows the older schema cannot represent.
      const db = new Database(':memory:');
      migrate(db);
      db.run('PRAGMA user_version = 999');
      expect(() => migrate(db)).toThrow(/newer version/i);
      db.close();
   });

   it('apply each migration in one transaction', () => {
      const dir = tempDir();
      // Written synchronously: `Bun.write` returns a promise, and an unawaited
      // one here means `migrate` reads an empty directory and the test proves
      // nothing.
      writeFileSync(join(dir, '0001_ok.sql'), 'CREATE TABLE a (x TEXT) STRICT;');
      // Second statement is invalid, so the first must roll back with it.
      writeFileSync(
         join(dir, '0002_broken.sql'),
         'CREATE TABLE b (x TEXT) STRICT; CREATE TABLE b (x TEXT) STRICT;',
      );

      const db = new Database(':memory:');
      expect(() => migrate(db, dir)).toThrow();
      // 0001 committed; 0002 left nothing behind.
      expect(userVersion(db)).toBe(1);
      const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
         name: string;
      }[];
      expect(tables.map((t) => t.name)).toContain('a');
      expect(tables.map((t) => t.name)).not.toContain('b');
      db.close();
   });
});

describe('the typed schema matches the database the SQL builds', () => {
   // The duplication between schema.ts and the migration SQL is only safe
   // because this runs. A column added to one and not the other fails here.
   const expected: Record<string, readonly string[]> = {
      sessions: columnNames(schema.sessions),
      messages: columnNames(schema.messages),
      tool_calls: columnNames(schema.toolCalls),
      memory_entries: columnNames(schema.memoryEntries),
      memory_pending: columnNames(schema.memoryPending),
      attachments: columnNames(schema.attachments),
   };

   it('has every table the schema declares, with every column', () => {
      const opened = openMain({ path: ':memory:' });
      try {
         for (const [table, wanted] of Object.entries(expected)) {
            const actual = columnsOf(opened.raw, table);
            for (const column of wanted) {
               expect(`${table}.${column}`).toBe(
                  actual.has(column) ? `${table}.${column}` : `${table}.MISSING(${column})`,
               );
            }
         }
      } finally {
         opened.close();
      }
   });

   it('carries profile_id on every table (INVARIANT 15)', () => {
      const opened = openMain({ path: ':memory:' });
      try {
         for (const table of Object.keys(expected)) {
            expect(columnsOf(opened.raw, table).has('profile_id')).toBe(true);
         }
      } finally {
         opened.close();
      }
   });
});

describe('main.db enforces its durability contract', () => {
   it('turns foreign keys on, so a cascade is real', () => {
      const opened = openMain({ path: ':memory:' });
      try {
         const row = opened.raw.query('PRAGMA foreign_keys').get() as {
            foreign_keys: number;
         };
         expect(row.foreign_keys).toBe(1);

         const sessionId = newId();
         opened.db
            .insert(schema.sessions)
            .values({ id: sessionId, provider: 'p', model: 'm' })
            .run();
         opened.db
            .insert(schema.messages)
            .values({ id: newId(), sessionId, role: 'user', content: 'hi', seq: 0 })
            .run();

         opened.raw.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
         const left = opened.raw.query('SELECT count(*) AS n FROM messages').get() as { n: number };
         expect(left.n).toBe(0);
      } finally {
         opened.close();
      }
   });

   it('refuses two messages at the same position in a session', () => {
      const opened = openMain({ path: ':memory:' });
      try {
         const sessionId = newId();
         opened.db
            .insert(schema.sessions)
            .values({ id: sessionId, provider: 'p', model: 'm' })
            .run();
         const insert = (): void => {
            opened.db
               .insert(schema.messages)
               .values({ id: newId(), sessionId, role: 'user', content: 'x', seq: 0 })
               .run();
         };
         insert();
         // A corrupt transcript should fail loudly, not render in some order.
         expect(insert).toThrow();
      } finally {
         opened.close();
      }
   });

   it('marks a message left mid-stream as interrupted (INVARIANT 6)', () => {
      const opened = openMain({ path: ':memory:' });
      try {
         const sessionId = newId();
         opened.db
            .insert(schema.sessions)
            .values({ id: sessionId, provider: 'p', model: 'm' })
            .run();

         const partialId = newId();
         opened.db
            .insert(schema.messages)
            .values({
               id: partialId,
               sessionId,
               role: 'assistant',
               content: 'half a th',
               seq: 0,
            })
            .run();
         // A user message with no finish reason is normal and must be left be.
         opened.db
            .insert(schema.messages)
            .values({ id: newId(), sessionId, role: 'user', content: 'q', seq: 1 })
            .run();

         expect(markDanglingAsInterrupted(opened.db)).toBe(1);

         const repaired = opened.raw
            .query('SELECT finish_reason FROM messages WHERE id = ?')
            .get(partialId) as { finish_reason: string };
         expect(repaired.finish_reason).toBe('interrupted');

         // Idempotent: a second boot repairs nothing.
         expect(markDanglingAsInterrupted(opened.db)).toBe(0);
      } finally {
         opened.close();
      }
   });

   it('checkpoints the WAL on close, so the file alone is a real backup', () => {
      const dir = tempDir();
      const path = join(dir, 'main.db');
      const opened = openMain({ path });
      opened.db.insert(schema.sessions).values({ id: newId(), provider: 'p', model: 'm' }).run();
      opened.close();

      // Copy *only* the main file — no -wal, no -shm — which is exactly what a
      // naive backup or a file-sync tool would take. If the checkpoint did not
      // happen, the row lives in the WAL and this copy is missing it.
      const backup = join(dir, 'backup.db');
      copyFileSync(path, backup);

      const again = openMain({ path: backup });
      try {
         const row = again.raw.query('SELECT count(*) AS n FROM sessions').get() as { n: number };
         expect(row.n).toBe(1);
      } finally {
         again.close();
      }
   });
});

describe('cache.db is disposable (INVARIANT 7)', () => {
   it('drops and rebuilds itself when the schema version moves', () => {
      const dir = tempDir();
      const path = join(dir, 'cache.db');

      const first = openCache({ path });
      first.raw.run(
         "INSERT INTO token_counts (key, model, tokens, created_at) VALUES ('k', 'm', 5, 0)",
      );
      expect(first.rebuilt).toBe(false);
      first.close();

      // Pretend the build moved on.
      const poke = new Database(path);
      poke.run('PRAGMA user_version = 99');
      poke.close();

      const second = openCache({ path });
      try {
         expect(second.rebuilt).toBe(true);
         const row = second.raw.query('SELECT count(*) AS n FROM token_counts').get() as {
            n: number;
         };
         // The memo is gone, which is the point: it can be recomputed.
         expect(row.n).toBe(0);
      } finally {
         second.close();
      }
   });

   it('rebuilds from nothing when the file is deleted', () => {
      // The documented recovery step: `rm cache.db` must always work.
      const dir = tempDir();
      const path = join(dir, 'cache.db');

      openCache({ path }).close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
      expect(existsSync(path)).toBe(false);

      const rebuilt = openCache({ path });
      try {
         expect(
            rebuilt.raw.query("SELECT name FROM sqlite_master WHERE name = 'token_counts'").get(),
         ).not.toBeNull();
      } finally {
         rebuilt.close();
      }
   });
});

/** Column names a Drizzle table declares, as they are spelled in SQL. */
function columnNames(table: SQLiteTable): string[] {
   return Object.values(getTableColumns(table)).map((column) => column.name);
}
