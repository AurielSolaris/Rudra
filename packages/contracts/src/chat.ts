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
      /** Characters emitted. Phase 1 adds token accounting alongside this. */
      chars: Type.Integer({ minimum: 0 }),
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
