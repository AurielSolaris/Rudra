/**
 * `cache.db` — disposable, unmigrated (PLAN.MD §6).
 *
 * INVARIANT 7: **`rm cache.db` is always safe and never touches user data.**
 * That is the whole design of this file. Nothing here is the only copy of
 * anything; every table is a memo of work that can be redone. If you find
 * yourself wanting to put something here that cannot be recomputed, it belongs
 * in `main.db` instead.
 *
 * There are no migrations. `client.ts` stamps a schema version and drops the
 * entire file when it does not match, which is cheaper and far more reliable
 * than migrating a cache — and it is the recovery step we document to users.
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Bump when any table below changes shape.
 *
 * Forgetting to is not catastrophic — SQLite will throw on the first query
 * against a changed table and the file gets rebuilt — but it is noisier than
 * stamping a number.
 */
export const CACHE_SCHEMA_VERSION = 1;

/** Rolling summaries of older turns, for the Phase 4 compaction path. */
export const summaries = sqliteTable(
   'summaries',
   {
      id: text('id').primaryKey(),
      sessionId: text('session_id').notNull(),
      /** Range of `messages.seq` this summary stands in for. */
      fromSeq: integer('from_seq').notNull(),
      toSeq: integer('to_seq').notNull(),
      content: text('content').notNull(),
      createdAt: integer('created_at').notNull(),
   },
   (table) => [index('summaries_session').on(table.sessionId, table.fromSeq)],
);

/**
 * Memoized tool results, keyed by a hash of (tool, args).
 *
 * Only ever populated for tools declared pure — a cached `run_command` would be
 * a lie about the state of the machine.
 */
export const toolResultCache = sqliteTable(
   'tool_result_cache',
   {
      key: text('key').primaryKey(),
      tool: text('tool').notNull(),
      result: text('result').notNull(),
      createdAt: integer('created_at').notNull(),
      expiresAt: integer('expires_at'),
   },
   (table) => [index('tool_result_expiry').on(table.expiresAt)],
);

/**
 * Token counts for strings we have already measured.
 *
 * Counting is the expensive part of staying inside a context window, and the
 * same system prompt is measured on every single turn.
 */
export const tokenCounts = sqliteTable('token_counts', {
   /** sha256(model + text). */
   key: text('key').primaryKey(),
   model: text('model').notNull(),
   tokens: integer('tokens').notNull(),
   createdAt: integer('created_at').notNull(),
});

/** Model lists fetched from a provider, so settings opens instantly. */
export const providerModels = sqliteTable('provider_models', {
   providerId: text('provider_id').primaryKey(),
   /** JSON array of ModelInfo. */
   models: text('models').notNull(),
   fetchedAt: integer('fetched_at').notNull(),
});

/**
 * Rendered mermaid SVG (PLAN.MD §5.8), keyed by
 * sha256(source + theme + mermaid version).
 *
 * Phase 4 fills this; the table exists now so `cache.db` is not reshaped later
 * for a feature we already know is coming.
 */
export const diagramCache = sqliteTable('diagram_cache', {
   key: text('key').primaryKey(),
   svg: text('svg').notNull(),
   createdAt: integer('created_at').notNull(),
});

export type SummaryRow = typeof summaries.$inferSelect;
export type ToolResultRow = typeof toolResultCache.$inferSelect;
export type TokenCountRow = typeof tokenCounts.$inferSelect;
export type ProviderModelsRow = typeof providerModels.$inferSelect;
export type DiagramRow = typeof diagramCache.$inferSelect;
