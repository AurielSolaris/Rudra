/**
 * `main.db` — the durable half (PLAN.MD §6).
 *
 * This file is the *typed view* of the schema. The schema itself is created by
 * the SQL in `packages/db/migrations/`, which is the single source of truth for
 * what is on disk; see `docs/decisions/0004-migrations.md` for why migrations
 * are hand-authored SQL rather than generated.
 *
 * Keeping both means this file must agree with the migrations, so
 * `packages/db/test/schema.test.ts` reflects over the real database and fails
 * if a column here does not exist there. That test is the only reason the
 * duplication is safe — the same bargain `limits.ts` makes with Dart.
 *
 * **Every table carries `profile_id`** (INVARIANT 15). v1 writes `'default'`
 * everywhere; multi-profile is deferred, not precluded (PLAN.MD §11.4).
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Timestamps are epoch milliseconds, matching the wire contracts. */
const now = sql`(unixepoch('subsec') * 1000)`;

export const sessions = sqliteTable(
   'sessions',
   {
      id: text('id').primaryKey(),
      profileId: text('profile_id').notNull().default('default'),
      title: text('title'),
      state: text('state', { enum: ['active', 'ended', 'archived'] })
         .notNull()
         .default('active'),
      createdAt: integer('created_at').notNull().default(now),
      updatedAt: integer('updated_at').notNull().default(now),
      provider: text('provider').notNull(),
      model: text('model').notNull(),
      tokensIn: integer('tokens_in').notNull().default(0),
      tokensOut: integer('tokens_out').notNull().default(0),
   },
   (table) => [
      // The session list is "most recent first, for this profile", so that is
      // the index. Without it the list is a scan plus a sort on every keystroke
      // in the sidebar.
      index('sessions_profile_updated').on(table.profileId, table.updatedAt),
   ],
);

export const messages = sqliteTable(
   'messages',
   {
      id: text('id').primaryKey(),
      sessionId: text('session_id')
         .notNull()
         .references(() => sessions.id, { onDelete: 'cascade' }),
      profileId: text('profile_id').notNull().default('default'),
      role: text('role', { enum: ['system', 'user', 'assistant', 'tool'] }).notNull(),
      content: text('content').notNull().default(''),
      createdAt: integer('created_at').notNull().default(now),
      /** Dense, ascending from 0 within a session. */
      seq: integer('seq').notNull(),
      /**
       * Null while streaming. INVARIANT 6: a row that was never finished must
       * not read as complete, so the loader rewrites a dangling null to
       * `interrupted` on startup rather than leaving it ambiguous.
       */
      finishReason: text('finish_reason', {
         enum: ['complete', 'interrupted', 'length', 'error', 'tool_calls'],
      }),
      tokensIn: integer('tokens_in'),
      tokensOut: integer('tokens_out'),
   },
   (table) => [
      // Paging walks a session backwards by `seq`, and the uniqueness is a real
      // constraint: two rows at the same position is a corrupt transcript, and
      // it is better to fail the insert than to render an arbitrary order.
      uniqueIndex('messages_session_seq').on(table.sessionId, table.seq),
   ],
);

export const toolCalls = sqliteTable(
   'tool_calls',
   {
      id: text('id').primaryKey(),
      messageId: text('message_id')
         .notNull()
         .references(() => messages.id, { onDelete: 'cascade' }),
      profileId: text('profile_id').notNull().default('default'),
      tool: text('tool').notNull(),
      /** JSON. Written on invoke (PLAN.MD §7), patched on completion. */
      args: text('args').notNull().default('{}'),
      result: text('result'),
      status: text('status', { enum: ['running', 'ok', 'error', 'cancelled'] })
         .notNull()
         .default('running'),
      startedAt: integer('started_at').notNull().default(now),
      endedAt: integer('ended_at'),
   },
   (table) => [index('tool_calls_message').on(table.messageId)],
);

/**
 * Mirror of the `.md` memory stores, for history and undo (Phase 2).
 *
 * INVARIANT 8: the files are the human source of truth. On a file-vs-DB
 * conflict the FILE wins, and `reconcile.ts` enforces that at startup. These
 * rows exist so an entry can be recovered after an edit, not so the DB can
 * disagree with the file.
 */
export const memoryEntries = sqliteTable(
   'memory_entries',
   {
      id: text('id').primaryKey(),
      profileId: text('profile_id').notNull().default('default'),
      store: text('store', { enum: ['memory', 'user'] }).notNull(),
      content: text('content').notNull(),
      createdAt: integer('created_at').notNull().default(now),
      /** Set when superseded, so history is append-only rather than destructive. */
      removedAt: integer('removed_at'),
   },
   (table) => [index('memory_entries_store').on(table.profileId, table.store, table.removedAt)],
);

/**
 * Staged memory writes awaiting approval (PLAN.MD §5.4).
 *
 * `pinnedTarget` holds the full text of the entry a patch/remove aims at. If
 * that entry changed between staging and approval the write is refused and
 * stays pending — an approval must never silently clobber something written
 * later.
 */
export const memoryPending = sqliteTable(
   'memory_pending',
   {
      id: text('id').primaryKey(),
      profileId: text('profile_id').notNull().default('default'),
      store: text('store', { enum: ['memory', 'user'] }).notNull(),
      action: text('action', { enum: ['add', 'patch', 'remove'] }).notNull(),
      content: text('content'),
      oldText: text('old_text'),
      pinnedTarget: text('pinned_target'),
      createdAt: integer('created_at').notNull().default(now),
   },
   (table) => [index('memory_pending_profile').on(table.profileId, table.createdAt)],
);

export const attachments = sqliteTable(
   'attachments',
   {
      id: text('id').primaryKey(),
      profileId: text('profile_id').notNull().default('default'),
      messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
      path: text('path').notNull(),
      mime: text('mime').notNull(),
      /** sha256 of the contents, so a re-attached file is recognised. */
      hash: text('hash').notNull(),
      bytes: integer('bytes').notNull(),
      createdAt: integer('created_at').notNull().default(now),
   },
   (table) => [index('attachments_hash').on(table.hash)],
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type ToolCallRow = typeof toolCalls.$inferSelect;
export type MemoryEntryRow = typeof memoryEntries.$inferSelect;
export type MemoryPendingRow = typeof memoryPending.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
