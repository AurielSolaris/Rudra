/**
 * Every numeric bound in Rudra, in one place.
 *
 * **Why this file exists.** "No RAM overload" is not a thing you achieve by
 * being careful; it is a thing you achieve by making every buffer that grows
 * from untrusted input have a named ceiling. Untrusted here means *everything
 * off a socket or a pipe* — including our own sidecar, because a sidecar that
 * has been replaced, downgraded, or wedged is exactly the case a limit is for.
 *
 * Rules for this file:
 *
 * 1. A bound lives here, never inline at the use site. An inline `> 4096` is
 *    invisible to review and impossible to test against.
 * 2. Every bound is a *byte* or *character* count, never "big enough". The unit
 *    is in the name.
 * 3. The Dart side mirrors these in `app/lib/core/limits.dart`, and
 *    `app/test/limits_test.dart` parses THIS file and fails if the two drift.
 *    That test is the only reason the duplication is safe.
 *
 * Mirrors: app/lib/core/limits.dart
 */

/**
 * Largest request body the server will read, in bytes.
 *
 * Enforced on `onRequest` from `content-length`, i.e. *before* Bun reads the
 * body and before TypeBox validates it. A contract `maxLength` is not a memory
 * bound: by the time a schema rejects an oversized string, the string has
 * already been allocated.
 */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/**
 * Largest single SSE frame a client should accept, in bytes.
 *
 * A frame is one event's `event:`/`data:` pair. Ours are small — a delta is a
 * few bytes of text. A megabyte without a frame boundary means the peer is not
 * speaking our protocol, and continuing to buffer it is how a parser becomes an
 * OOM. Mirrored because the *client* is what has to enforce it.
 */
export const MAX_SSE_FRAME_BYTES = 1024 * 1024;

/**
 * Largest accumulated assistant message, in characters.
 *
 * A provider that never emits a terminal event is a real failure mode (a broken
 * stop sequence will do it). At this ceiling the message completes with reason
 * `length`, which is already a first-class outcome the UI renders — so the cap
 * degrades into a designed state instead of an error.
 */
export const MAX_MESSAGE_CHARS = 256 * 1024;

/**
 * Largest number of messages held in a transcript at once.
 *
 * Phase 0 keeps the transcript in memory, so this is a hard RAM bound: at the
 * message ceiling above it caps a session's worst case. Phase 1 moves the
 * backing store to `main.db` and this becomes the window kept resident, with
 * older messages paged in — the cap stays, its meaning narrows.
 */
export const MAX_TRANSCRIPT_MESSAGES = 2000;

/** Largest error-response body a client will read before giving up, in bytes. */
export const MAX_ERROR_BODY_BYTES = 64 * 1024;

/**
 * Largest handshake line, in characters.
 *
 * The real line is ~200 characters. Anything approaching this is not a
 * handshake, and the point is to stop reading rather than to parse it.
 */
export const MAX_HANDSHAKE_LINE_CHARS = 4096;

/** Largest single log line kept from the sidecar's stderr, in characters. */
export const MAX_LOG_LINE_CHARS = 2000;

/** Number of sidecar log lines retained for the boot-failure surface. */
export const MAX_LOG_LINES = 40;
