# 0004 — Hand-authored SQL migrations, not generated ones

Date: 2026-10-27. Status: accepted. Supersedes a line in MAP.txt.

## What changed

MAP.txt listed `packages/db/drizzle/` as "generated migrations", implying
`drizzle-kit generate`. Phase 1 ships `packages/db/migrations/*.sql`, written by
hand and applied by `packages/db/src/migrate.ts`, with progress tracked in
SQLite's `user_version` pragma.

Drizzle itself is unchanged and still earns its place: `schema.ts` gives typed
queries, which is the reason it was chosen over Prisma (PLAN.MD §3). Only the
migration _generator_ is dropped.

## Why

**The schema is going to need raw SQL anyway.** Phase 3 adds an FTS5 virtual
table with external content plus sync triggers (PLAN.MD §6). `drizzle-kit`
cannot express either, so those arrive as custom SQL files regardless. The
choice was never "generated or hand-written" — it was "one mechanism or two".
Two mechanisms means every future migration starts by asking which kind it is.

**A desktop database has exactly one copy of the user's data.** There is no
staging environment and no re-run. A migration is the single most dangerous
thing this app does to a file it cannot replace, and it should be legible in
review without a tool in the loop to explain it. The SQL in `0001_initial.sql`
is the schema, readable top to bottom.

**`user_version` cannot drift.** A journal file describing which migrations ran
is itself state that can disagree with the database. An integer in the SQLite
header commits inside the same transaction as the DDL it describes, so the
version and the schema are never separately wrong.

## What keeps it honest

The cost of hand-writing is that `schema.ts` and the SQL can disagree — the
exact drift PLAN.MD §3 complains about for types. So they are checked, not
trusted: `packages/db/test/db.test.ts` opens a real migrated database, reflects
over it with `PRAGMA table_info`, and fails if any column Drizzle declares is
missing. The same bargain `limits.ts` makes with its Dart mirror.

The runner enforces two rules that make a half-applied database impossible:

- **One migration, one transaction**, with `user_version` set inside it. A
  failing statement rolls the file back to the version it had.
- **Contiguous numbering from 0001**, refused rather than guessed. A gap means a
  file was lost, and applying what remains yields a schema no version describes.

A database stamped with a version this build does not know is refused outright:
migrating down cannot be done correctly, and opening it anyway risks writing
rows the older schema cannot represent.

## Not in scope

`cache.db` is never migrated and this file does not apply to it. On a schema
mismatch it is deleted and rebuilt (PLAN.MD §6, INVARIANT 7).
