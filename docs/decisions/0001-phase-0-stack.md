# 0001 — Phase 0 stack decisions

Date: 2026-10-26. Status: accepted.

## Elysia 1.4, not 2.0

Elysia 2.0 is at `2.0.0-rc.0`; stable is 1.4.30. The official `elysiajs` skill
documents v2 and says plainly: _"For v1, use migration to recognize differences,
not as permission to upgrade."_ This is the foundation of a long project, so it
sits on stable. Revisit when 2.0 ships final — the skill's `migration.md`
is the map.

## `bun test`, not Vitest; no Cypress

Asked for ESLint + Prettier + Vitest + Cypress. The first two are in. The other
two do not fit this stack:

- **Vitest** runs on Node. The server is Elysia on `Bun.serve`, which Node cannot
  host without the `@elysia/node` adapter — so Vitest would test a different
  runtime than we ship. `bun test` shares Vitest's `describe/it/expect` API, so
  no test would need rewriting if that ever changes.
- **Cypress** drives a browser. The UI is Flutter desktop, which has no DOM for
  Cypress to attach to. The real equivalents are `flutter test` (widget), Flutter's
  `integration_test` (driver), and `tooling/smoke` for the backend.

If a web surface ever appears, Vitest and Cypress become correct for it. Today
they would be ceremony that tests nothing.

## Two test layers

- `bun test` — in-process, no port. Fast, no CI port contention. The Elysia skill
  notes `app.handle()` needs no listener, which is the pattern to prefer as the
  suite grows.
- `bun run smoke` — a real subprocess over a real socket. Only this can prove the
  handshake, parent-death watch, stdout discipline, and shutdown. It prints a
  human-readable PASS/FAIL report, because it is meant to be run by hand.

## 3-space indentation

Prettier `tabWidth: 3` for TypeScript, enforced by `fmt:check` in CI.

Dart is the exception: `dart format` hardcodes 2 spaces and is deliberately not
configurable upstream. `.editorconfig` matches that rather than fighting it.

## Measured: sidecar is 94.7 MB

`bun build --compile` produces 94.7 MB; adding `--minify --bytecode` makes it
_larger_ (98.1 MB). The weight is the embedded Bun runtime. PLAN.MD §3 has been
corrected from its 55–90 MB estimate. Consequence: ~35% smaller than Electron on
disk rather than ~90%, with the startup and memory wins intact.
