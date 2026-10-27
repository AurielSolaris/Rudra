# Rudra — Plan

> A personal AI agent with a native desktop GUI and a real memory.
> Inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT) — same memory
> model, different stack, much smaller scope.
>
> Status: **planning**. Nothing implemented yet. Created 2026-10-26.
> Name: **Rudra** (chosen 2026-10-26 over Vasudeva and Ishtar — see §11.1).

---

## 1. What this is

A single-user desktop agent that:

- runs a **chat loop** against any LLM provider you point it at,
- has **persistent, curated memory** that survives across sessions,
- **autosaves everything** so a crash never loses a conversation,
- can **read/write files, run shell commands, and search**,
- and looks good doing it.

## 2. What this is explicitly NOT

Scope discipline is the point of this document. These are Hermes features we are
deliberately **not** building:

| Not building                                                           | Why                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Subagents / delegation / parallel workstreams                          | No need. This is the single biggest complexity saving.            |
| Messaging gateway (Telegram, Discord, Slack, WhatsApp, Signal)         | Desktop only.                                                     |
| TUI                                                                    | The GUI _is_ the product.                                         |
| Cron scheduler / unattended automations                                | Phase 4 at the earliest.                                          |
| Remote terminal backends (Docker, SSH, Modal, Daytona, Vercel Sandbox) | Local shell only.                                                 |
| Batch trajectory generation / training-data export                     | Research feature, not a product feature.                          |
| Plugin system, MCP catalog                                             | Fixed tool set. Revisit only if the tool list stops being enough. |
| Voice memo transcription                                               | Out of scope.                                                     |
| Browser automation                                                     | Out of scope.                                                     |

If a feature is not in §4 or §9, it is not in scope. Adding to those sections is
a decision, not a drive-by.

## 3. Stack

| Layer         | Choice                                              | Rationale                                                                                                                                                                                 |
| ------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GUI           | **Flutter**, desktop-only (Windows / macOS / Linux) | Skia-rendered, no webview, identical across platforms, excellent animation. Dropping Android/Web unlocks unrestricted `dart:io` + `dart:ffi`.                                             |
| Backend       | **TypeScript** on **Bun**, **ElysiaJS**             | Properly typed end-to-end. `bun build --compile` ships one standalone sidecar binary — no runtime for the user to install.                                                                |
| ORM           | **Drizzle**                                         | Pure TS, zero codegen in the build loop, no Rust query-engine binary to package, raw-SQL escape hatch for FTS5 and `sqlite-vec`. Prisma was considered and rejected on packaging grounds. |
| Database      | **SQLite x2** — `main.db` + `cache.db`              | See §6.                                                                                                                                                                                   |
| Transport     | HTTP + SSE over loopback                            | SSE is the simplest correct answer for token streaming.                                                                                                                                   |
| Schema bridge | **TypeBox** -> JSON Schema -> generated Dart models | Elysia's Eden only types TS clients. Dart needs codegen or the types silently drift.                                                                                                      |
| UI state      | **Riverpod** (+ `riverpod_generator`)               | Compile-checked providers, good testability, no BuildContext coupling. Streaming deltas stay out of the provider graph on purpose.                                                        |
| Config        | **TOML** at `~/.rudra/config.toml`                  | Typed and unambiguous; avoids YAML's implicit-cast footguns.                                                                                                                              |
| Native code   | **C via `dart:ffi`, only if needed**                | Not a planned layer. Held in reserve (likely candidate: tree-sitter for syntax highlighting).                                                                                             |

### Size expectation — **measured 2026-10-26**

Flutter app ~25–40 MB + compiled Bun sidecar **94.7 MB** = **~120–135 MB**
installed, versus Electron's ~200 MB.

That sidecar number is measured, not estimated, and it is above the 55–90 MB this
section first guessed. Two findings worth recording:

- `bun build --compile --minify --bytecode` produces a **larger** binary (98.1 MB).
  The weight is the embedded Bun runtime, not our code — our bundle is 334
  modules and a rounding error against it. There is no flag that fixes this.
- So the size win over Electron is real but modest: roughly **35%** smaller on
  disk, not the 90% the webview options would have given. The wins that remain
  large are **startup time** and **memory** (~80–150 MB RSS vs ~400 MB).

If disk size ever becomes a hard requirement, the sidecar is the only thing worth
attacking, and the lever is the runtime — a Go rewrite of the server would land
near 15 MB. That is a real trade against the end-to-end typing we chose TypeScript
for (§11.3), and it is not worth making pre-emptively. Recorded so the decision
is available later with a number attached.

## 4. Feature set

### 4.1 Chat

> Visual and interaction contract: **`docs/ui-guidelines.md`**. It merges the
> general interface guidelines (translated to Flutter) with Hermes'
> `apps/desktop/DESIGN.md`, which we deliberately replicate.

- Streaming responses, token by token.
- Interrupt and redirect mid-generation.
- Markdown rendering: headings, lists, tables, links, inline and block code.
- Syntax-highlighted code blocks with copy button.
- Math via `flutter_math_fork` (KaTeX subset).
- **Mermaid diagrams via headless render in the sidecar** (§5.8). Not dropped.
- Message editing and regeneration.
- Virtualized scrollback (`ListView.builder`); must stay smooth at 5,000+ messages.

### 4.2 Memory (replicating Hermes' model — see §5)

- Two curated stores: `MEMORY.md` (agent notes) and `USER.md` (user profile).
- Hard character limits; no silent auto-compaction.
- `memory` tool with `add` / `patch` / `remove`, batched.
- Frozen system-prompt snapshot per session.
- Optional write-approval gate.
- Full-text session search across all past conversations.

### 4.3 Tools

- **Filesystem**: `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`.
- **Shell**: `run_command` — real PTY, streamed output, cancellable.
- **Search**: `grep` over allowed roots (ripgrep if present, JS fallback otherwise);
  `web_search` optional and provider-keyed.
- **Memory**: `memory`, `session_search`.

That is the whole tool list. Eight tools. Every one of them is sent on every API
call, so additions have a real token cost — treat the list as closed.

### 4.4 Providers — multi-compatibility

Default to an **OpenAI-compatible** adapter with a user-editable base URL. That
one adapter covers Nous Portal, OpenRouter, OpenAI, Together, Groq, Ollama,
LM Studio, and vLLM. Native adapters for Anthropic and Gemini are additive and
optional (Phase 3), behind the same internal interface.

Per-provider config: base URL, API key, model id, context window, temperature,
max tokens, whether tool calling is supported.

### 4.5 Autosave

Non-negotiable: **losing a conversation to a crash is a bug, not a limitation.**
See §7.

## 5. Memory design

Faithful to Hermes, because the design is well reasoned and the reasoning is
documented. Credit where due.

### 5.1 Two stores

| Store    | File                          | Limit                  | Holds                                                                                      |
| -------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `memory` | `~/.rudra/memories/MEMORY.md` | 2,200 chars (~800 tok) | Environment facts, project conventions, tool quirks, lessons learned, completed-work diary |
| `user`   | `~/.rudra/memories/USER.md`   | 1,375 chars (~500 tok) | Name, role, timezone, communication preferences, pet peeves, skill level                   |

Entries are separated by `§` on its own line. Entries may be multiline.

### 5.2 Frozen snapshot

Memory is read from disk **once at session start** and rendered into the system
prompt as an immutable block:

```
==============================================
MEMORY (your personal notes) [67% - 1,474/2,200 chars]
==============================================
<entry>
§
<entry>
```

It never changes mid-session. **This is load-bearing**, not laziness: mutating
the system prompt mid-conversation invalidates the provider's prefix cache and
multiplies cost on every subsequent turn. Writes land on disk immediately and
become visible to the _next_ session. Tool responses always echo live state, so
the model is never confused about what it just wrote.

### 5.3 The `memory` tool

```ts
{ target: "memory" | "user",            // required, top-level
  operations: [
    { action: "add",    content: string },
    { action: "patch",  old_text: string, content: string },
    { action: "remove", old_text: string },
  ]}
```

Rules, each one earning its place:

- **No `read` action.** Memory is already in the system prompt.
- **No `replace` action.** Hermes removed theirs: models used it as find-and-swap
  and wiped co-located facts in multi-fact entries. `patch` replaces a _span
  inside_ an entry and keeps the rest.
- **`target` is top-level and mandatory.** A per-operation target that disagrees
  with it is an error before anything is written. Updating both stores takes two calls.
- **Substring matching** for `patch`/`remove`: `old_text` need only be a unique
  substring. Ambiguous match -> error. Exact whole-entry match wins over substring.
  A span occurring twice within one entry -> error, retry with more context.
- **Limits are checked on the batch result, not per operation.** So one batch can
  free space and add an entry atomically.
- **Full means error, never silent truncation.** The error names the exact
  shortfall in characters and returns `current_entries` so the model can
  consolidate and retry in a single batch:

```json
{
   "success": false,
   "error": "Memory at 2,100/2,200 chars; adding this entry (250 chars) would exceed the limit by 153 chars. Retry as ONE batch that frees >=153 chars AND adds this entry.",
   "current_entries": ["..."],
   "usage": "2,100/2,200"
}
```

- **A miss returns near-misses.** Failed `old_text` -> `closest_entries` in the error.
- **Exact duplicates are rejected** as a soft success ("no duplicate added").
- **Every entry is security-scanned before acceptance.** Memory is injected into
  the system prompt, which makes it a persistent injection vector. Block on:
  prompt-injection patterns, credential-exfiltration patterns, and invisible
  Unicode (zero-width, bidi overrides, tag characters). This is not optional.

### 5.4 Write approval

Config `memory.write_approval` (default `false` = write freely).
When `true`, writes are **staged**, not applied, and reviewed in the GUI:
pending list -> approve / reject (one or all).

Staged `patch`/`remove` writes **pin the full text of the entry they target**. If
that entry changed between staging and approval, the write is refused and stays
pending. This prevents an approval from silently clobbering something written
later. A staged write with no verifiable target is refused outright.

### 5.5 Session search (autosave's payoff)

- Every message of every session is in `main.db`, indexed with **FTS5**.
- `session_search` has three shapes: **discovery** (query -> ranked hits with
  session and message ids), **scroll** (session id + anchor -> N messages
  forward/back), **browse** (list sessions by recency with titles).
- Returns real stored messages. No LLM summarization, no truncation, no cost.
- Semantic recall is Phase 4 via `sqlite-vec` — FTS5 first, because it is free,
  instant, and surprisingly hard to beat for "did we talk about X?"

### 5.6 Why session boundaries matter

Memory only pays off when a session _ends_ — that is the moment the curated
stores carry facts forward and `session_search` covers the rest. The GUI must
therefore make **"New session"** a prominent, one-keystroke action, and should
suggest one after a long or clearly finished task. An app that encourages one
infinite session gets expensive and never exercises its own learning loop.

### 5.7 Deferred: the background review

Hermes runs a post-turn background review that curates memory and self-improves
skills. That is the heart of its learning loop and it is genuinely good — but it
is also an extra LLM call per turn plus a whole consent surface. **Phase 4.**
Until then, memory is written by the model in-turn, on its own initiative, with
the system prompt telling it what is worth saving.

Skills (self-authored, self-improving procedural files) are **out of scope for
v1** and are the most likely Phase 5 addition.

### 5.8 Mermaid: headless rendering

Diagrams render **in the sidecar**, not in Flutter. The pipeline:

```
mermaid source (from model output)
  -> sidecar: render headless, theme-aware
  -> SVG
  -> cache.db keyed by sha256(source + theme + mermaid version)
  -> Flutter: flutter_svg draws it inline in the transcript
```

**Engine, and the cost to decide on.** Mermaid needs real text metrics
(`getBBox`) to lay out, which `jsdom` does not provide — under a DOM shim the
output is reliably mis-laid-out rather than cleanly broken. Correct rendering
therefore needs a browser engine. Bundling one (`@mermaid-js/mermaid-cli` +
Puppeteer's Chromium) adds **~150-300 MB**, which would more than double the
install and void the size argument in §3.

So: **opportunistic engine detection.** On first use, look for an already-installed
Chromium-family browser (Edge is always present on Windows; Chrome/Chromium
commonly on macOS and Linux) and drive that. If none is found, the code block
renders as a normal highlighted `mermaid` block with a quiet "no renderer found"
affordance explaining how to enable it. **We never bundle a browser**, and a
missing one degrades to something honest rather than broken.

**Security — mermaid source is untrusted model output.** Non-negotiable:
`securityLevel: 'strict'`, `htmlLabels: false`, the headless process gets **no
network access** and a scratch tmpdir, and render runs under a timeout with a
hard output-size cap. Mermaid has a history of label-based XSS; we are feeding it
text a model produced from pages it read. Treat it as hostile input.

SVG is preferred over PNG (scales with UI zoom, themeable, smaller to cache). A
diagram type whose SVG `flutter_svg` mis-renders falls back to PNG at 2x.

## 6. Data layer

Two SQLite files, split for **durability and disposability** — not for
performance. WAL handles a single-writer desktop load without breaking a sweat.

### `main.db` — durable, migrated, backed up

`synchronous=NORMAL`, `journal_mode=WAL`, foreign keys on.

- `sessions` — id, title, created_at, updated_at, provider, model, token totals
- `messages` — id, session_id, role, content, created_at, seq, finish_reason
- `tool_calls` — id, message_id, tool, args (json), result, status, started/ended
- `messages_fts` — FTS5 virtual table (external content), synced by trigger
- `memory_entries` — mirror of the `.md` stores, for history and undo
- `memory_pending` — staged writes plus pinned target text
- `attachments` — path, mime, hash

### `cache.db` — disposable, unmigrated

`synchronous=OFF`, WAL. **No migrations: on schema mismatch, drop and recreate.**

- `summaries`, `tool_result_cache`, `token_counts`, `provider_models`,
  `diagram_cache` (rendered mermaid SVG, §5.8), `embeddings` (Phase 4)

`rm cache.db` is a valid, safe, documented recovery step and can never touch user
data. Use `ATTACH` if a cross-file join is ever genuinely needed.

The `.md` files remain the **human-facing source of truth** for memory, so the
user can open and edit them in any editor. The DB mirror exists for history and
undo; the loader reconciles file-vs-DB on startup with **the file winning**.

## 7. Autosave semantics

| Event                                 | Write                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------- |
| User sends a message                  | Committed to `main.db` **before** the provider request fires           |
| Assistant streaming                   | Deltas buffered in memory, flushed to the row on a **250 ms debounce** |
| Stream ends / errors / is interrupted | Final flush plus `finish_reason`, in one transaction                   |
| Tool call                             | Row written on invoke, patched on completion                           |
| Memory write                          | `.md` file and DB mirror in the same operation, fsync'd                |
| App quit (including SIGTERM)          | Flush buffers, checkpoint WAL, close cleanly                           |

A hard kill mid-stream loses at most 250 ms of tokens, and the partial message is
marked `finish_reason: "interrupted"` on next load rather than appearing complete.

## 8. Process model and security

- Flutter spawns the Bun sidecar as a child process and owns its lifecycle.
- The sidecar binds **`127.0.0.1` on port 0**, then prints `{port, token}` as one
  JSON line on stdout. Flutter reads it and sends that token on every request.
- **Never a fixed port, always a token.** Without this, any webpage open in the
  user's browser can drive an agent that has shell access. This is the single
  most important security decision in the design.
- The sidecar dies with its parent. Orphan detection on startup.
- API keys live in the OS keychain (`flutter_secure_storage`), never in config files.

Tool permissions:

- **Filesystem roots are an explicit allowlist.** No reads or writes outside them.
- Writes outside the session's working directory require confirmation.
- `run_command` requires confirmation by default; per-command "always allow" is
  remembered in a visible, revocable list.
- Shell output is capped, and spilled to a file above the cap.

## 9. Milestones

### Phase 0 — Skeleton

Monorepo layout, Bun + Elysia hello-world, Flutter desktop shell, sidecar spawn
with port/token handshake, SSE echo endpoint working end to end, TypeBox->Dart
codegen wired into the build.

### Phase 1 — Chat that works

OpenAI-compatible provider adapter, streaming SSE, message persistence to
`main.db`, autosave per §7, Markdown and code highlighting, session list and
switching, settings for provider/model/key.

### Phase 2 — Memory

Both stores with limits and the `§` format, frozen snapshot injection, the
`memory` tool with the full rule set from §5.3, security scanner, DB mirror,
memory panel in the GUI, write-approval gate and pending-review UI.

### Phase 3 — Tools and recall

Filesystem tools plus allowlist, PTY shell with streamed output and cancel, grep
search, FTS5 and `session_search`'s three shapes, tool-call cards in the UI,
permission prompts, Anthropic and Gemini native adapters.

### Phase 4 — Polish and packaging

Installers for all three platforms, auto-update (`auto_updater`), crash-recovery
UX, theming, keyboard shortcuts, onboarding. Then optionally: background review,
`sqlite-vec` semantic recall, journey/timeline visualization, cron.

### Phase 5 — Maybe

Skills. Plugins. Only if the fixed tool set has demonstrably stopped being enough.

## 10. Known risks

| Risk                                                               | Mitigation                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Streaming-Markdown incremental re-layout is the hardest UI piece   | Build it first in Phase 1, in isolation, against a token-replay fixture                   |
| TypeBox->Dart codegen drifts or gets skipped                       | Make it a build step that **fails the build**, not a manual script                        |
| Bun sidecar size eats the Electron win                             | Measure in Phase 0. If unacceptable, decide before Phase 1, not after                     |
| Flutter desktop accessibility is thinner than a browser's          | Accept and document; keyboard navigation is the floor and is non-negotiable               |
| Linux GTK embedder build friction                                  | CI matrix from Phase 0 — do not discover this at packaging time                           |
| Memory as a persistent prompt-injection vector                     | §5.3 scanner, mandatory, with tests before the feature ships                              |
| Mermaid needs a browser engine; bundling one voids the §3 size win | Detect a system Chromium-family browser, never bundle. Degrade visibly when absent (§5.8) |
| Scope creep back toward full Hermes                                | §2 is the contract. Changing it is a decision with a date and a reason                    |

## 11. Open decisions

1. ~~Final name~~ — **resolved 2026-10-26: Rudra.** Chosen over Vasudeva and Ishtar
   on typing ergonomics and spelling unambiguity. Binary `rudra`, home `~/.rudra/`.
   Note: the containing folder is still named `Vasudeva`.

   **Referent:** the _Vedic_ Rudra — the Rigvedic deity in his own right, the
   precursor who was later absorbed into Śiva (_śiva_, "auspicious", begins as a
   propitiatory epithet for him). Not "an aspect of Shiva"; the direction runs the
   other way. Fitting for this project because that Rudra is also
   `jalāṣa-bheṣaja` — the holder of the cooling remedy, invoked as a healer — and
   this is an agent whose real job is keeping and returning what it knows.
   A precursor absorbed into a larger figure, which is also Hermes' own story.

2. ~~License~~ — **resolved: MIT.** Matches Hermes, whose memory design we
   replicate; attribution to them is owed and is recorded in `docs/ui-guidelines.md`
   and this file's header.
3. ~~Config file format~~ — **resolved: TOML.** Typed, unambiguous, no YAML
   footguns (`no` parsing as `false`, significant indentation, tag soup).
   Config at `~/.rudra/config.toml`, parsed into a TypeBox-validated shape.
4. ~~Multi-profile support~~ — **resolved: deferred, schema must not preclude it.**
   v1 is single-profile. Every path resolves through one `profileRoot()` helper and
   `main.db` rows carry a `profile_id` defaulting to `"default"`, so adding profiles
   later is a UI and router change, not a migration of user data. **TBD.**
5. ~~Mermaid~~ — **resolved: headless renderer.** Sidecar renders to SVG, Flutter
   draws it, `cache.db` memoizes it. Design and its one cost: §5.8.
6. **Flutter state management** — **resolved: Riverpod** (with `riverpod_generator`).
   Rules in `docs/ui-guidelines.md` §12. Note the one hard constraint: streaming
   token deltas must _not_ flow through the provider graph.
