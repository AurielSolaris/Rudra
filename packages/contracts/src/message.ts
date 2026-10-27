import { Type, type Static } from '@sinclair/typebox';
import { Id } from './common.ts';

/**
 * Message contracts.
 *
 * Every message of every session is persisted (PLAN.MD §4.5, §7), so these
 * shapes describe both what the transcript reads back and what autosave wrote.
 * Timestamps are epoch milliseconds for the reason given in `session.ts`.
 */

export const MessageRole = Type.Union(
   [Type.Literal('system'), Type.Literal('user'), Type.Literal('assistant'), Type.Literal('tool')],
   { $id: 'MessageRole', description: 'Who produced the message.' },
);

export type MessageRoleT = Static<typeof MessageRole>;

/**
 * How a message stopped.
 *
 * `interrupted` is load-bearing: INVARIANT 6 says a partial message is never
 * presented as a complete one, and this field is how the UI knows. A message
 * still being written has `null` — absent would be ambiguous against an older
 * row whose reason was never recorded.
 */
export const FinishReason = Type.Union(
   [
      Type.Literal('complete'),
      Type.Literal('interrupted'),
      Type.Literal('length'),
      Type.Literal('error'),
      Type.Literal('tool_calls'),
   ],
   { $id: 'FinishReason', description: 'Why generation stopped.' },
);

export type FinishReasonT = Static<typeof FinishReason>;

export const Message = Type.Object(
   {
      id: Id,
      sessionId: Id,
      role: MessageRole,
      content: Type.String(),
      /** Epoch milliseconds. */
      createdAt: Type.Integer({ minimum: 0 }),
      /** Position within the session, dense and ascending from 0. */
      seq: Type.Integer({ minimum: 0 }),
      /**
       * Absent while the message is still streaming. Optional rather than
       * nullable for the reason spelled out on `Session.title`.
       */
      finishReason: Type.Optional(FinishReason),
      tokensIn: Type.Optional(Type.Integer({ minimum: 0 })),
      tokensOut: Type.Optional(Type.Integer({ minimum: 0 })),
   },
   { $id: 'Message', additionalProperties: false },
);

export type MessageT = Static<typeof Message>;

/**
 * A page of history, newest-last.
 *
 * Paging is by `seq` rather than offset: a transcript is append-only, so a
 * cursor stays valid while an offset silently shifts under concurrent writes.
 */
export const MessagePage = Type.Object(
   {
      messages: Type.Array(Message),
      /** Lowest `seq` in this page. Pass as `before` to walk further back. */
      nextCursor: Type.Optional(Type.Integer({ minimum: 0 })),
   },
   { $id: 'MessagePage', additionalProperties: false },
);

export type MessagePageT = Static<typeof MessagePage>;
