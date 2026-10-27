import { Type, type Static } from '@sinclair/typebox';
import { ApiError, Id } from './common.ts';

/**
 * Chat contracts.
 *
 * Phase 0 defines only the **echo** route and the SSE event union. The echo
 * exists to prove the whole spine end to end — Dart -> HTTP -> Elysia -> SSE ->
 * Dart — before a provider is involved. The event union it streams is the *real*
 * one, so Phase 1 swaps the source of the deltas and changes nothing else.
 */

/**
 * Start a real turn.
 *
 * The user's message is committed to `main.db` *before* the provider request
 * fires (PLAN.MD §7), so a crash between the two loses nothing: the message is
 * already there and the assistant row simply never arrives.
 */
export const ChatRequest = Type.Object(
   {
      sessionId: Id,
      message: Type.String({ minLength: 1, maxLength: 128_000 }),
   },
   { $id: 'ChatRequest', additionalProperties: false },
);

export type ChatRequestT = Static<typeof ChatRequest>;

export const EchoRequest = Type.Object(
   {
      message: Type.String({ minLength: 1, maxLength: 8192 }),
      /** Milliseconds between emitted chunks. Lets the UI exercise slow streams. */
      delayMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000, default: 15 })),
      /** Emit a terminal error instead of `done`, to exercise the failure path. */
      failAfter: Type.Optional(Type.Integer({ minimum: 0 })),
   },
   { $id: 'EchoRequest', additionalProperties: false },
);

export type EchoRequestT = Static<typeof EchoRequest>;

/** Stream opened. Carries the id the deltas belong to. */
export const StreamStart = Type.Object(
   {
      type: Type.Literal('start'),
      messageId: Id,
      /**
       * Absent on `/chat/echo`, which has no session. On a real turn this is
       * the row autosave is already writing into, so the client can reconcile
       * the stream against history it loads later.
       */
      sessionId: Type.Optional(Id),
      /** Position of the assistant message in the transcript. */
      seq: Type.Optional(Type.Integer({ minimum: 0 })),
   },
   { $id: 'StreamStart', additionalProperties: false },
);

/**
 * One chunk of text.
 *
 * INVARIANT 11 (MAP.txt): on the Dart side a delta goes to that message's
 * `ValueNotifier` — it must never pass through the Riverpod provider graph, or a
 * 5,000-row transcript rebuilds on every token.
 */
export const StreamDelta = Type.Object(
   {
      type: Type.Literal('delta'),
      text: Type.String(),
   },
   { $id: 'StreamDelta', additionalProperties: false },
);

/** Terminal success. `reason` distinguishes a complete stream from a cut one. */
export const StreamDone = Type.Object(
   {
      type: Type.Literal('done'),
      reason: Type.Union([
         Type.Literal('complete'),
         Type.Literal('interrupted'),
         Type.Literal('length'),
      ]),
      /** Characters emitted. Always present; cheap and never guessed. */
      chars: Type.Integer({ minimum: 0 }),
      /**
       * Token counts as the provider reported them. Optional because a great
       * many OpenAI-compatible endpoints omit usage on a streamed response, and
       * a fabricated estimate in a field the UI displays as a cost is worse
       * than an honest blank.
       */
      tokensIn: Type.Optional(Type.Integer({ minimum: 0 })),
      tokensOut: Type.Optional(Type.Integer({ minimum: 0 })),
   },
   { $id: 'StreamDone', additionalProperties: false },
);

/** Terminal failure. The partial text already delivered stays displayed. */
export const StreamError = Type.Object(
   {
      type: Type.Literal('error'),
      error: ApiError,
   },
   { $id: 'StreamError', additionalProperties: false },
);

export const StreamEvent = Type.Union([StreamStart, StreamDelta, StreamDone, StreamError], {
   $id: 'StreamEvent',
   description: 'Discriminated on `type`. Exactly one terminal event per stream.',
});

export type StreamEventT = Static<typeof StreamEvent>;
export type StreamStartT = Static<typeof StreamStart>;
export type StreamDeltaT = Static<typeof StreamDelta>;
export type StreamDoneT = Static<typeof StreamDone>;
export type StreamErrorT = Static<typeof StreamError>;
