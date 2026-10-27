/**
 * POST /chat/echo
 *
 * The Phase 0 spine prover. It streams the request back as SSE deltas using the
 * **real** event union (`@rudra/contracts/chat`), so Phase 1 replaces the source
 * of the deltas — a provider instead of a string — and touches nothing else:
 * not the framing, not the client parser, not the Dart models.
 *
 * It also exists permanently as a test fixture: `delayMs` exercises slow
 * streams, `failAfter` exercises the terminal-error path, and neither needs an
 * API key or a network.
 */

import { Elysia } from 'elysia';
import { newId } from '@rudra/shared/ids';
import { createLogger } from '@rudra/shared/logger';
import { EchoRequest, type EchoRequestT, type StreamEventT } from '@rudra/contracts';
import { sseResponse } from '../sse.ts';

const log = createLogger('chat');

/** Chunk size in characters. Small enough to look like token streaming. */
const CHUNK = 4;

function sleep(ms: number): Promise<void> {
   return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Produce the event sequence.
 *
 * Written as an async generator so cancellation is free: when the client
 * disconnects, `sseResponse` stops pulling and the loop's `aborted` check ends
 * it. That is the same shape Phase 1's provider stream will have.
 */
async function* echoStream(
   body: EchoRequestT,
   isAborted: () => boolean,
): AsyncGenerator<StreamEventT> {
   const messageId = newId();
   yield { type: 'start', messageId };

   const delay = body.delayMs ?? 15;
   let sent = 0;

   for (let i = 0; i < body.message.length; i += CHUNK) {
      if (isAborted()) {
         // Terminal event still emitted, so the client never has to infer a cut
         // stream from silence (PLAN.MD §7).
         yield { type: 'done', reason: 'interrupted', chars: sent };
         return;
      }

      if (body.failAfter !== undefined && sent >= body.failAfter) {
         yield {
            type: 'error',
            error: { code: 'upstream', message: 'Simulated upstream failure.' },
         };
         return;
      }

      const text = body.message.slice(i, i + CHUNK);
      sent += text.length;
      yield { type: 'delta', text };

      if (delay > 0) await sleep(delay);
   }

   yield { type: 'done', reason: 'complete', chars: sent };
}

export const chatRoutes = new Elysia({ prefix: '/chat' }).post(
   '/echo',
   ({ body }) => {
      let aborted = false;
      log.debug('echo stream opened', { chars: body.message.length });
      return sseResponse(
         echoStream(body, () => aborted),
         {
            onAbort: () => {
               aborted = true;
            },
         },
      );
   },
   { body: EchoRequest },
);
