import { Type, type Static } from '@sinclair/typebox';

/**
 * Shared schema fragments.
 *
 * INVARIANT 10 (MAP.txt): Dart types are GENERATED from this package. Nothing
 * here is hand-mirrored on the Flutter side — `tooling/schema-to-dart` emits it,
 * and `--check` fails the build when the committed Dart drifts.
 *
 * Every schema carries `$id`, because the generator names the Dart class from it.
 */

/** A sortable Rudra id (see @rudra/shared/ids). */
export const Id = Type.String({
   $id: 'Id',
   pattern: '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$',
   description: 'Sortable 26-character identifier (ULID layout, Crockford base32).',
});

export const ErrorCodeSchema = Type.Union(
   [
      Type.Literal('invalid'),
      Type.Literal('unauthorized'),
      Type.Literal('not_found'),
      Type.Literal('forbidden'),
      Type.Literal('cancelled'),
      Type.Literal('upstream'),
      Type.Literal('internal'),
   ],
   { $id: 'ErrorCode', description: 'Stable failure codes the UI may branch on.' },
);

export type ErrorCodeT = Static<typeof ErrorCodeSchema>;

/** The one error shape. Mirrors AppError in @rudra/shared/result. */
export const ApiError = Type.Object(
   {
      code: ErrorCodeSchema,
      message: Type.String({ description: 'Safe to display. Never contains secrets.' }),
      detail: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
   },
   { $id: 'ApiError', additionalProperties: false },
);

export type ApiErrorT = Static<typeof ApiError>;

/** Returned by GET /health. The Flutter shell polls this during boot. */
export const HealthResponse = Type.Object(
   {
      ok: Type.Literal(true),
      version: Type.String(),
      /** Seconds since the sidecar started. */
      uptime: Type.Number(),
      /** Protocol version, bumped when the handshake or route shapes change. */
      protocol: Type.Integer({ minimum: 1 }),
   },
   { $id: 'HealthResponse', additionalProperties: false },
);

export type HealthResponseT = Static<typeof HealthResponse>;

/**
 * The handshake line the sidecar prints to stdout, exactly once, before serving
 * (PLAN.MD §8). The Flutter shell parses the first stdout line as this.
 *
 * INVARIANT 18: nothing else is ever written to stdout.
 */
export const Handshake = Type.Object(
   {
      rudra: Type.Literal('handshake'),
      protocol: Type.Integer({ minimum: 1 }),
      version: Type.String(),
      /** Chosen by the OS — we always bind port 0. Never a fixed port. */
      port: Type.Integer({ minimum: 1, maximum: 65535 }),
      /** Bearer token required on every request. 32 random bytes, hex. */
      token: Type.String({ minLength: 64, maxLength: 64 }),
      pid: Type.Integer({ minimum: 1 }),
   },
   { $id: 'Handshake', additionalProperties: false },
);

export type HandshakeT = Static<typeof Handshake>;

export const PROTOCOL_VERSION = 1;
