import { Type, type Static } from '@sinclair/typebox';
import { Id } from './common.ts';

/**
 * Session contracts.
 *
 * A session is the unit memory is organised around (PLAN.MD §5.6): the curated
 * stores carry facts forward when one *ends*, and `session_search` covers the
 * rest. So a session is a first-class, named, listable thing from Phase 1
 * rather than an implicit container the transcript happens to live in.
 *
 * **Timestamps are epoch milliseconds, not ISO strings.** An ISO string has to
 * be parsed on the Dart side, and `DateTime.parse` throws `FormatException`
 * from inside the `async*` body that reads the stream — the exact failure
 * INVARIANT 20 exists to prevent. An integer is read by `_reqInt` and cannot
 * fail that way.
 */

/** How a session ended, which is what decides whether memory had its moment. */
export const SessionState = Type.Union(
   [Type.Literal('active'), Type.Literal('ended'), Type.Literal('archived')],
   {
      $id: 'SessionState',
      description: 'Lifecycle of a session. Only an active session accepts new turns.',
   },
);

export type SessionStateT = Static<typeof SessionState>;

export const Session = Type.Object(
   {
      id: Id,
      /**
       * Absent until the first exchange names it. The UI shows a placeholder
       * rather than inventing a title, because a wrong title is worse than none
       * when the session list is how you find a conversation again.
       *
       * Optional rather than nullable on purpose: the Dart generator types an
       * optional as `String?` read by `_optStr`, which accepts both an absent
       * field and an explicit `null`. A `Union([String, Null])` has no `type`
       * for the generator to dispatch on and would degrade to `dynamic`,
       * quietly costing us INVARIANT 20 for this field.
       */
      title: Type.Optional(Type.String({ maxLength: 200 })),
      state: SessionState,
      /** Epoch milliseconds. */
      createdAt: Type.Integer({ minimum: 0 }),
      /** Epoch milliseconds. Bumped on every persisted message. */
      updatedAt: Type.Integer({ minimum: 0 }),
      /** The provider id this session is bound to, from the provider registry. */
      provider: Type.String({ maxLength: 64 }),
      /** The model id as the provider spells it. */
      model: Type.String({ maxLength: 200 }),
      messageCount: Type.Integer({ minimum: 0 }),
      /** Cumulative prompt tokens billed to this session, as reported upstream. */
      tokensIn: Type.Integer({ minimum: 0 }),
      /** Cumulative completion tokens. */
      tokensOut: Type.Integer({ minimum: 0 }),
   },
   { $id: 'Session', additionalProperties: false },
);

export type SessionT = Static<typeof Session>;

export const SessionList = Type.Object(
   {
      sessions: Type.Array(Session),
      /**
       * Pass as `before` to get the next page. Absent when the list is
       * exhausted — which is the only reliable end signal, since a page can be
       * short without being last once deletes are in play.
       */
      nextCursor: Type.Optional(Id),
   },
   { $id: 'SessionList', additionalProperties: false },
);

export type SessionListT = Static<typeof SessionList>;

export const CreateSessionRequest = Type.Object(
   {
      /** Omitted means "use the configured default provider". */
      provider: Type.Optional(Type.String({ maxLength: 64 })),
      model: Type.Optional(Type.String({ maxLength: 200 })),
      title: Type.Optional(Type.String({ maxLength: 200 })),
   },
   { $id: 'CreateSessionRequest', additionalProperties: false },
);

export type CreateSessionRequestT = Static<typeof CreateSessionRequest>;

export const RenameSessionRequest = Type.Object(
   { title: Type.String({ minLength: 1, maxLength: 200 }) },
   { $id: 'RenameSessionRequest', additionalProperties: false },
);

export type RenameSessionRequestT = Static<typeof RenameSessionRequest>;
