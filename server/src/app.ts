/**
 * The Elysia app.
 *
 * Built by a factory rather than exported as a singleton so tests can stand up
 * an instance with their own token and no global state.
 */

import { Elysia } from 'elysia';
import { createLogger } from '@rudra/shared/logger';
import { MAX_REQUEST_BODY_BYTES } from '@rudra/shared/limits';
import { checkAuth, hasForeignOrigin, unauthorizedResponse } from './auth.ts';
import { unexpectedResponse } from './errors.ts';
import { healthRoutes } from './routes/health.ts';
import { chatRoutes } from './routes/chat.ts';

const log = createLogger('app');

export interface AppOptions {
   /** The bearer token every request must present. */
   token: string;
}

/**
 * Headers for a refusal issued before the request body has been read.
 *
 * **Why `connection: close` is mandatory here.** Every rejection below happens
 * in `onRequest`, which by design runs before the body is consumed — that is
 * the whole point of the size guard. But an HTTP/1.1 connection is a byte
 * stream: the body we declined to read is still arriving, and on a keep-alive
 * connection the server parses those leftover bytes as the start of the *next*
 * request. The next legitimate request on that connection then fails with a
 * spurious 400.
 *
 * That is not hypothetical — it is exactly what a chunked body refused with 411
 * did, and it desynchronised the connection for whatever came next. RFC 9112
 * §9.6 gives the remedy: a server that refuses a request without reading its
 * body closes the connection. Refusing is cheap; refusing *and* corrupting the
 * next request is a bug.
 */
const REFUSAL_HEADERS = { connection: 'close', 'cache-control': 'no-store' } as const;

/**
 * Read and discard a request body we have already decided to refuse.
 *
 * Only the **chunked** case needs this. When a body declares its length, the
 * server knows how many bytes to skip and the connection stays in sync by
 * itself (measured). When it does not, those bytes are still arriving with no
 * framing to skip, and the next request on that connection is parsed out of
 * them — so it must be drained.
 *
 * This is not a hole in the size guard, and in particular it is not a buffer:
 * chunks are counted and dropped, never accumulated, so peak memory is one
 * chunk regardless of how much is sent. The read still stops at
 * `MAX_REQUEST_BODY_BYTES` (INVARIANT 19 — the ceiling is named, not inline).
 * Past that we stop reading and let `connection: close` deal with the remainder:
 * we are refusing the request either way, and a dirty connection we are closing
 * costs nothing.
 */
async function drainBody(request: Request): Promise<void> {
   const body = request.body;
   if (body === null) return;

   const reader = body.getReader();
   let dropped = 0;
   try {
      for (;;) {
         const { done, value } = await reader.read();
         if (done) break;
         dropped += value.byteLength;
         if (dropped > MAX_REQUEST_BODY_BYTES) break;
      }
   } catch {
      // The peer hung up mid-body. Nothing to sync any more.
   } finally {
      try {
         await reader.cancel();
      } catch {
         // Already closed by the peer. Nothing left to release.
      }
   }
}

export function createApp({ token }: AppOptions) {
   return (
      new Elysia()
         /**
          * The guard runs on `onRequest`, before routing and before body parsing.
          *
          * This ordering is deliberate: an unauthenticated caller must not be able
          * to make us parse a body, allocate for a large payload, or learn which
          * paths exist from differing status codes. Everything is 401 until the
          * token checks out.
          */
         .onRequest(({ request }) => {
            // `onRequest` runs before routing, so there is no matched route yet
            // and the path comes off the URL. That ordering is the point: an
            // unauthenticated caller never reaches body parsing or routing.
            const path = new URL(request.url).pathname;
            if (hasForeignOrigin(request)) {
               log.warn('rejected request with Origin header', { path });
               return new Response(null, { status: 403, headers: REFUSAL_HEADERS });
            }
            const auth = checkAuth(request, token);
            if (!auth.authorized) return unauthorizedResponse(auth, path);

            /**
             * Body size is bounded here, before the body is read.
             *
             * A contract `maxLength` is not a memory bound: TypeBox rejects an
             * oversized string only after it has been allocated. This runs
             * first, off `content-length`, so an oversized request costs a
             * header parse. A body with no `content-length` is chunked, which
             * nothing we serve uses, so it is refused rather than streamed.
             */
            if (request.method === 'POST' || request.method === 'PUT') {
               const declared = request.headers.get('content-length');
               if (declared === null) {
                  log.warn('rejected body with no content-length', { path });
                  // The one refusal that must drain first — see `drainBody`.
                  // Returning the promise rather than making this whole guard
                  // `async` keeps the happy path synchronous.
                  return drainBody(request).then(() =>
                     Response.json(
                        { code: 'invalid', message: 'A request body must declare its length.' },
                        { status: 411, headers: REFUSAL_HEADERS },
                     ),
                  );
               }
               const size = Number(declared);
               if (!Number.isSafeInteger(size) || size < 0) {
                  return Response.json(
                     { code: 'invalid', message: 'Malformed content-length.' },
                     { status: 400, headers: REFUSAL_HEADERS },
                  );
               }
               if (size > MAX_REQUEST_BODY_BYTES) {
                  log.warn('rejected oversized body', { path, size });
                  return Response.json(
                     {
                        code: 'invalid',
                        message: `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`,
                     },
                     { status: 413, headers: REFUSAL_HEADERS },
                  );
               }
            }

            return undefined;
         })
         .onError(({ code, error, path, set }) => {
            // Elysia's own validation failures map to 400 with its message; anything
            // else is ours and gets the generic treatment.
            if (code === 'VALIDATION') {
               set.status = 400;
               return { code: 'invalid', message: 'Request did not match the contract.' };
            }
            if (code === 'NOT_FOUND') {
               set.status = 404;
               return { code: 'not_found', message: 'No such route.' };
            }
            return unexpectedResponse(error, path);
         })
         .use(healthRoutes)
         .use(chatRoutes)
   );
}
