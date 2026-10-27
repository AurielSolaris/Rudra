# 0003 — Every buffer gets a ceiling; wire data gets a typed reader

**Date:** 2026-10-27
**Status:** accepted
**Scope:** INVARIANT 19, INVARIANT 20

## Why

Two properties were asked for directly: **memory safety** ("no RAM overload")
and **type safety** ("no failing due to wrong data"). Neither is visible in a
screenshot and neither is something you get by being careful, so both were
turned into enforced invariants with tests written as attacks.

## What was actually wrong

An audit of every place input enters the process found five unbounded buffers
and two crash-on-wrong-data paths. These were real, not hypothetical:

| Where                               | Failure                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `api/sse.dart` carry buffer         | A peer that never sends `\n\n` grows it until OOM; `toString()` per chunk made it O(n²)              |
| `StreamingMessage._buffer`          | A provider that never emits a terminal event (a broken stop sequence does it) grows it without limit |
| `MessageStore.state`                | Transcript grew unbounded; Phase 0 holds it entirely in memory                                       |
| `LineSplitter` on sidecar stdout    | A newline-free torrent on the pipe buffers forever                                                   |
| `bytesToString()` on an error body  | The _error_ path buffered whatever the peer chose to send                                            |
| Generated `fromJson` raw `as` casts | Wrong field type threw `TypeError` out of an `async*` body                                           |
| `ErrorCode.fromWire`                | Threw `ArgumentError` on an unknown code, so a backend one release ahead took down the client        |

One thing the audit cleared rather than fixed: `StreamingMessage.value` is **not**
O(n²). `ValueListenableBuilder` calls `setState`, so `value` is read once per
_frame_, not once per notify, and the `_dirty` cache makes intra-frame appends
free. The remaining per-frame O(n) is Flutter's text-layout floor. It was left
alone.

## Decisions

### 1. Bounds live in one file, per side

`packages/shared/src/limits.ts` is the source of truth;
`app/lib/core/limits.dart` mirrors it. An inline `> 4096` is invisible to review
and impossible to test against.

The duplication is deliberate — these are read on the hot path, and a generated
file would need regenerating to read a constant — and it is made safe by
`app/test/safety_test.dart`, which **parses the TypeScript source** and fails the
build if the two disagree. That test is the entire justification for the
duplication; without it the mirror would rot.

### 2. "Untrusted input" includes our own sidecar

The sidecar is first-party code, which makes it tempting to trust its output.
It is still a separate process that can be wedged, downgraded, replaced, or
mid-upgrade. Every bound applies to it exactly as to a hostile peer.

### 3. A bound degrades into a designed state, never an exception

- An over-long message completes with `StreamEndReason.length` — already a
  first-class outcome the UI renders.
- A malformed frame becomes a terminal `StreamError` — the same door a
  server-sent error uses, which is why the UI needs exactly one error path.
- A trimmed transcript exposes `droppedCount` rather than hiding the trim.

Truncation respects UTF-16 surrogate pairs: cutting mid-pair leaves an unpaired
half that renders as a replacement character, which is a visible corruption at
precisely the moment the user is already looking at a truncated reply.

### 4. Size is checked before the body is read, not by the schema

`EchoRequest.message` has `maxLength: 8192`, which is **not** a memory bound:
TypeBox rejects an oversized string only once it has been allocated. The guard
runs on `onRequest`, off `content-length`, before routing and before body
parsing. A body with no `content-length` is chunked — which nothing we serve
uses — so it is refused with 411 rather than streamed to find out how big it is.

Auth is still checked _first_. An oversized body from an unauthenticated caller
gets 401, not 413: a differing status would confirm the route exists and reveal
the limit. There is a test for that ordering.

### 5. `fromJson` uses typed readers, not casts

The generator emits `_reqStr`/`_optInt`/… instead of `as`. One exception type,
`WireTypeError`, carries the field name and what was expected, so a mismatch
names itself and the two call sites have one thing to catch.

The readers are **liberal where JSON is genuinely ambiguous and strict
everywhere else**: `5.0` is accepted for an integer field, because JSON has one
number type; `"5"` is not, because that is a real contract break being papered
over. Non-finite numbers are rejected — they cannot come from `jsonDecode`, but
they can come from a hand-built map, and they propagate into layout as a crash.

Inline string unions are validated for membership too. `StreamDone.reason` was
previously "some string", which forced the caller into a default case it could
only guess at — and guessing `complete` would report a cut stream as a finished
one.

### 6. Enums are strict, with an explicit escape hatch

`fromWire` raises; `tryFromWire` returns null. Silently mapping an unknown
member onto an arbitrary one is a lie the UI would then act on. Callers that
would rather degrade than fail say so at the call site, where the trade is
visible — `ApiException.fromBody` does exactly this.

## Verification

`app/test/safety_test.dart` (35 tests) and `server/test/safety.test.ts` (6).
Every test is written as an attack: feed the input that would break it, assert
it degrades as designed. A happy-path test cannot distinguish a bound that works
from one that was never wired up.

The SSE bound was confirmed to **fail when the cap is removed**, rather than
merely passing against the fixed code.

CI previously ran no Dart tests at all. `.github/workflows/ci.yml` now has an
`app` job running `app:check` and `app:spine` on all three OSes.
