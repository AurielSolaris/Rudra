# Rudra ☤

A personal AI agent with a native desktop GUI and a real memory.

Inspired by [Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT) —
the same memory model, a different stack, a much smaller scope.

> **Status: Phase 0 complete.** Backend spine and desktop shell both work end to
> end — the app boots its own backend and streams a reply. There is no LLM and no
> persistence yet; that is Phase 1. See [`PLAN.MD`](PLAN.MD) for scope and
> [`MAP.txt`](MAP.txt) for what exists.

---

## The commands you need

```bash
bun install          # once

bun run app:run      # ← the desktop app (boots its own backend)
bun run check:all    # everything: backend + app + end-to-end + smoke

bun run smoke        # backend only: boots the real sidecar, prints PASS/FAIL
bun run dev          # run the sidecar in watch mode
```

**If something is broken, run `bun run smoke`.** It spawns the sidecar exactly as
the desktop app will, exercises every path, and prints a named report. Paste the
failing lines and that is a complete bug report.

Individually:

| Command                 | What it does                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `bun run smoke`         | Subprocess test: handshake, auth, SSE, stdout discipline, shutdown (19 checks) |
| `bun test`              | In-process unit tests (14 tests, no port needed)                               |
| `bun run lint`          | ESLint, type-aware rules                                                       |
| `bun run fmt`           | Prettier, **3-space indent**                                                   |
| `bun run typecheck`     | `tsc --noEmit` across all five projects                                        |
| `bun run codegen`       | Regenerate Dart models from the TypeBox contracts                              |
| `bun run codegen:check` | Fail if the committed Dart has drifted                                         |
| `bun run fix`           | `lint:fix` + `fmt`                                                             |

## Stack

| Layer     | Choice                                                                 |
| --------- | ---------------------------------------------------------------------- |
| GUI       | Flutter, desktop only (Windows / macOS / Linux) — **not built yet**    |
| State     | Riverpod                                                               |
| Backend   | TypeScript on Bun, ElysiaJS 1.4                                        |
| ORM       | Drizzle — **Phase 1**                                                  |
| Database  | SQLite ×2: `main.db` (durable) + `cache.db` (disposable) — **Phase 1** |
| Transport | HTTP + SSE over loopback                                               |
| Contracts | TypeBox → JSON Schema → generated Dart                                 |

## Layout

```
packages/shared/      result, logger, paths, ids — no dependencies on anything
packages/contracts/   TypeBox schemas. THE source of truth for both languages.
server/               Elysia sidecar: handshake, auth, routes, SSE
tooling/schema-to-dart/  contracts -> app/lib/api/generated/models.dart
tooling/smoke/        the subprocess smoke runner
app/                  Flutter app (only generated models so far)
docs/                 ui-guidelines.md and decision records
```

## How the desktop app talks to the backend

1. Flutter spawns the sidecar with `RUDRA_PARENT_PID` set.
2. The sidecar binds `127.0.0.1` on **port 0** and prints **one** line of JSON to
   stdout: `{"rudra":"handshake","port":…,"token":…}`.
3. Flutter reads that line and sends `Authorization: Bearer <token>` on every
   request thereafter.
4. The sidecar dies with its parent — via stdin EOF, ppid polling, or a signal.

Two rules this depends on, both enforced by tests:

- **Never a fixed port, always a token.** The sidecar will have shell access. On
  loopback, any page in the user's browser can send it a request; the token is
  what stops that.
- **stdout belongs to the handshake line alone.** All logging goes to stderr. A
  stray `console.log` corrupts boot, which is why `no-console` is an error.

## Documentation

| File                                             | Contents                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| [`PLAN.MD`](PLAN.MD)                             | Scope, the explicit non-goals, memory design, data layer, milestones, risks |
| [`MAP.txt`](MAP.txt)                             | Every component with phase and status, plus 18 load-bearing invariants      |
| [`docs/ui-guidelines.md`](docs/ui-guidelines.md) | The UI contract — read before writing any widget                            |
| [`docs/decisions/`](docs/decisions/)             | One short record per decision                                               |

## Attribution

The memory design in `PLAN.MD` §5 and much of `docs/ui-guidelines.md` follow
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT).
Adopted because the reasoning is sound and documented.

MIT licensed.

---

## Contact

Maintained by [AurielSolaris](https://github.com/AurielSolaris) —
<debadityamalakar@gmail.com>.

Bug reports are welcome as GitHub issues. The most useful report names the
command you ran and pastes what it printed; every check in the table above is
designed to fail loudly rather than quietly.
