/**
 * Every schema, re-exported for codegen.
 *
 * `tooling/schema-to-dart` imports `SCHEMAS` from here and emits one Dart class
 * per entry. Adding a schema means adding it to `SCHEMAS` — a schema that is not
 * listed is not generated, and `--check` cannot catch what it never saw.
 */

import type { TSchema } from '@sinclair/typebox';

export * from './common.ts';
export * from './chat.ts';

import { ApiError, ErrorCodeSchema, HealthResponse, Id } from './common.ts';
import {
   EchoRequest,
   StreamDelta,
   StreamDone,
   StreamError,
   StreamEvent,
   StreamStart,
} from './chat.ts';

/**
 * The codegen manifest. Order is the emission order, so keep it stable to keep
 * generated diffs readable.
 */
export const SCHEMAS: readonly TSchema[] = [
   // common
   Id,
   ErrorCodeSchema,
   ApiError,
   HealthResponse,
   // NOTE: `Handshake` is deliberately NOT generated for Dart. It arrives on
   // stdout rather than in an HTTP body, so the Dart side needs a parser that
   // returns null on malformed input instead of throwing — a boot failure is a
   // state to render, not an exception to crash on. See
   // app/lib/boot/handshake.dart, which validates every field of that schema.
   // chat
   EchoRequest,
   StreamStart,
   StreamDelta,
   StreamDone,
   StreamError,
   StreamEvent,
] as const;
