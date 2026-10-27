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
               return new Response(null, { status: 403 });
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
                  return Response.json(
                     { code: 'invalid', message: 'A request body must declare its length.' },
                     { status: 411 },
                  );
               }
               const size = Number(declared);
               if (!Number.isSafeInteger(size) || size < 0) {
                  return Response.json(
                     { code: 'invalid', message: 'Malformed content-length.' },
                     { status: 400 },
                  );
               }
               if (size > MAX_REQUEST_BODY_BYTES) {
                  log.warn('rejected oversized body', { path, size });
                  return Response.json(
                     {
                        code: 'invalid',
                        message: `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes.`,
                     },
                     { status: 413 },
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
