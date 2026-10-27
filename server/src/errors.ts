/**
 * One error shape, one place that maps it to HTTP.
 *
 * A route never builds its own error body. It returns an `AppError`, or throws
 * (which means a bug), and this module decides the status and the wire shape.
 */

import { createLogger } from '@rudra/shared/logger';
import { ErrorCode, type AppError, describeCause } from '@rudra/shared/result';
import type { ApiErrorT } from '@rudra/contracts';

const log = createLogger('errors');

const STATUS: Record<AppError['code'], number> = {
   [ErrorCode.Invalid]: 400,
   [ErrorCode.Unauthorized]: 401,
   [ErrorCode.Forbidden]: 403,
   [ErrorCode.NotFound]: 404,
   [ErrorCode.Cancelled]: 499, // nginx's "client closed request"; apt for an interrupt
   [ErrorCode.Upstream]: 502,
   [ErrorCode.Internal]: 500,
};

/**
 * Strip an AppError down to what may leave the process.
 *
 * `cause` is logged and dropped: stack traces and provider payloads can carry
 * paths and keys, and the client has no use for them.
 */
export function toApiError(error: AppError): ApiErrorT {
   return {
      code: error.code,
      message: error.message,
      ...(error.detail !== undefined ? { detail: error.detail } : {}),
   };
}

export function errorResponse(error: AppError): Response {
   if (error.cause !== undefined) {
      log.exception('request failed', error.cause, { code: error.code });
   }
   return Response.json(toApiError(error), {
      status: STATUS[error.code],
      headers: { 'cache-control': 'no-store' },
   });
}

/**
 * Last-resort handler for a thrown value.
 *
 * Reaching here means a route threw instead of returning a Result — a bug. The
 * client gets a generic 500; the detail goes to the log.
 */
export function unexpectedResponse(cause: unknown, path: string): Response {
   log.exception('unhandled error in route', cause, { path });
   return Response.json(
      { code: ErrorCode.Internal, message: 'Internal error.' } satisfies ApiErrorT,
      { status: 500, headers: { 'cache-control': 'no-store' } },
   );
}

/** For logs and tests. */
export function formatError(error: AppError): string {
   const base = `[${error.code}] ${error.message}`;
   return error.cause === undefined ? base : `${base} (${describeCause(error.cause)})`;
}
