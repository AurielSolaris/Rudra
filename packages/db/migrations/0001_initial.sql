-- 0001 — the Phase 1 shape of main.db (PLAN.MD §6).
--
-- Applied by packages/db/src/migrate.ts, which tracks progress in SQLite's own
-- `user_version` pragma. Migrations run in one transaction each: a half-applied
-- migration is the one failure mode that leaves a user with no good options.
--
-- Every table carries `profile_id` (INVARIANT 15). v1 writes 'default'.
-- Timestamps are epoch milliseconds, matching the wire contracts.

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT    NOT NULL DEFAULT 'default',
  title       TEXT,
  state       TEXT    NOT NULL DEFAULT 'active'
              CHECK (state IN ('active', 'ended', 'archived')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  provider    TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX sessions_profile_updated ON sessions (profile_id, updated_at);

CREATE TABLE messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT    NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  profile_id    TEXT    NOT NULL DEFAULT 'default',
  role          TEXT    NOT NULL
                CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content       TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  seq           INTEGER NOT NULL,
  -- NULL means "still streaming". The loader rewrites a NULL left behind by a
  -- crash to 'interrupted' at startup, so a partial message is never presented
  -- as a complete one (INVARIANT 6).
  finish_reason TEXT
                CHECK (finish_reason IS NULL OR finish_reason IN
                       ('complete', 'interrupted', 'length', 'error', 'tool_calls')),
  tokens_in     INTEGER,
  tokens_out    INTEGER
) STRICT;

-- Two messages at the same position is a corrupt transcript. Failing the insert
-- beats rendering an arbitrary order.
CREATE UNIQUE INDEX messages_session_seq ON messages (session_id, seq);

CREATE TABLE tool_calls (
  id         TEXT PRIMARY KEY,
  message_id TEXT    NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  profile_id TEXT    NOT NULL DEFAULT 'default',
  tool       TEXT    NOT NULL,
  args       TEXT    NOT NULL DEFAULT '{}',
  result     TEXT,
  status     TEXT    NOT NULL DEFAULT 'running'
             CHECK (status IN ('running', 'ok', 'error', 'cancelled')),
  started_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  ended_at   INTEGER
) STRICT;

CREATE INDEX tool_calls_message ON tool_calls (message_id);

-- Mirror of the .md stores. INVARIANT 8: the FILE wins on conflict; these rows
-- exist for history and undo, not to disagree with it.
CREATE TABLE memory_entries (
  id         TEXT PRIMARY KEY,
  profile_id TEXT    NOT NULL DEFAULT 'default',
  store      TEXT    NOT NULL CHECK (store IN ('memory', 'user')),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  removed_at INTEGER
) STRICT;

CREATE INDEX memory_entries_store
  ON memory_entries (profile_id, store, removed_at);

-- Staged writes awaiting approval (PLAN.MD §5.4). `pinned_target` holds the
-- full text of the entry a patch/remove aims at, so an approval cannot clobber
-- an entry that changed after staging.
CREATE TABLE memory_pending (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT    NOT NULL DEFAULT 'default',
  store         TEXT    NOT NULL CHECK (store IN ('memory', 'user')),
  action        TEXT    NOT NULL CHECK (action IN ('add', 'patch', 'remove')),
  content       TEXT,
  old_text      TEXT,
  pinned_target TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
) STRICT;

CREATE INDEX memory_pending_profile ON memory_pending (profile_id, created_at);

CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  profile_id TEXT    NOT NULL DEFAULT 'default',
  message_id TEXT    REFERENCES messages (id) ON DELETE CASCADE,
  path       TEXT    NOT NULL,
  mime       TEXT    NOT NULL,
  hash       TEXT    NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
) STRICT;

CREATE INDEX attachments_hash ON attachments (hash);
