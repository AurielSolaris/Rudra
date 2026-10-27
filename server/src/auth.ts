/**
 * Bearer-token guard.
 *
 * PLAN.MD §8 — the single most important security decision in the design. The
 * sidecar can read files and run shell commands. It listens on loopback, which
 * is NOT a security boundary: any page in the user's browser can POST to
 * 127.0.0.1. Without a token, a visited web page could drive the agent.
 *
 * So: every route is guarded, the token is 32 CSPRNG bytes handed to the shell
 * over stdout, and comparison is constant-time.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@rudra/shared/logger';

const log = createLogger('auth');

/**
 * Timing-safe string comparison.
 *
 * Hash both sides first so the buffers are always the same length —
 * `timingSafeEqual` throws on a length mismatch, and branching on length would
 * itself leak how long the real token is.
 */
function constantTimeEqual(a: string, b: string): boolean {
   const ha = createHash('sha256').update(a, 'utf8').digest();
   const hb = createHash('sha256').update(b, 'utf8').digest();
   return timingSafeEqual(ha, hb);
}

export interface AuthResult {
   readonly authorized: boolean;
   /** Why it failed, for the log only. Never returned to the caller. */
   readonly reason?: 'missing' | 'malformed' | 'mismatch';
}

/**
 * Check one request.
 *
 * Accepts `Authorization: Bearer <token>`. A query parameter is deliberately
 * NOT accepted: query strings land in logs and shell history.
 */
export function checkAuth(request: Request, expected: string): AuthResult {
   const header = request.headers.get('authorization');
   if (header === null || header === '') return { authorized: false, reason: 'missing' };

   const parts = header.split(' ');
   const [scheme, presented] = parts;
   if (parts.length !== 2 || scheme === undefined || presented === undefined) {
      return { authorized: false, reason: 'malformed' };
   }
   if (scheme.toLowerCase() !== 'bearer') {
      return { authorized: false, reason: 'malformed' };
   }
   if (!constantTimeEqual(presented, expected)) {
      return { authorized: false, reason: 'mismatch' };
   }
   return { authorized: true };
}

/**
 * Reject an unauthenticated request.
 *
 * The body says nothing about *why*. A caller who does not have the token
 * learns only that it was refused.
 */
export function unauthorizedResponse(result: AuthResult, path: string): Response {
   log.warn('rejected unauthenticated request', { path, reason: result.reason });
   return Response.json(
      { code: 'unauthorized', message: 'Missing or invalid token.' },
      {
         status: 401,
         // `connection: close` for the same reason as every other pre-body
         // refusal — see REFUSAL_HEADERS in app.ts. An unauthenticated POST's
         // body is never read, so the connection must not be reused.
         headers: {
            'www-authenticate': 'Bearer',
            'cache-control': 'no-store',
            connection: 'close',
         },
      },
   );
}

/**
 * Reject a cross-origin request.
 *
 * Belt and braces alongside the token: a browser page cannot read a
 * cross-origin response without CORS, but it *can* fire the request. We send no
 * CORS headers at all and additionally refuse any request carrying an `Origin`,
 * because nothing legitimate here has one — the Flutter client is not a browser.
 */
export function hasForeignOrigin(request: Request): boolean {
   const origin = request.headers.get('origin');
   return origin !== null && origin !== '' && origin !== 'null';
}
