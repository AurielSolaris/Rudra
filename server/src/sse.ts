/**
 * Server-Sent Events framing.
 *
 * Written against the Web `Response`/`ReadableStream` primitives rather than a
 * framework helper, so the wire format is ours and does not move when Elysia
 * does. SSE over WebSockets was a deliberate choice (PLAN.MD §3): one
 * direction, trivially cancellable, no ping/pong state machine.
 */

import { createLogger } from '@rudra/shared/logger';
import { describeCause } from '@rudra/shared/result';
import type { StreamEventT } from '@rudra/contracts';

const log = createLogger('sse');

/** Encode one event. Data is JSON on a single line, so no multiline escaping. */
function frame(event: StreamEventT): string {
   return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export interface SseOptions {
   /**
    * Called when the client disconnects or the stream is aborted. This is how
    * interruption reaches the agent loop: the signal fires, the provider request
    * is cancelled, and the partial message is persisted as `interrupted`
    * (PLAN.MD §7).
    */
   onAbort?: () => void;
}

/**
 * Turn an async iterable of events into an SSE `Response`.
 *
 * The generator is pulled only as fast as the client reads, so backpressure is
 * inherited from the socket rather than buffered in memory.
 */
export function sseResponse(
   events: AsyncIterable<StreamEventT>,
   options: SseOptions = {},
): Response {
   const encoder = new TextEncoder();
   let aborted = false;

   const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
         try {
            for await (const event of events) {
               if (aborted) break;
               controller.enqueue(encoder.encode(frame(event)));
            }
         } catch (cause) {
            // A throw inside the generator is a bug in our code, not a client
            // error. Report it on the stream so the UI shows a real failure rather
            // than a silently truncated response, then close.
            log.exception('stream generator threw', cause);
            if (!aborted) {
               controller.enqueue(
                  encoder.encode(
                     frame({
                        type: 'error',
                        error: { code: 'internal', message: 'Stream failed.' },
                     }),
                  ),
               );
            }
         } finally {
            try {
               controller.close();
            } catch {
               // Already closed by an abort. Nothing to do.
            }
         }
      },
      cancel(reason) {
         aborted = true;
         log.debug('client cancelled stream', { reason: describeCause(reason) });
         options.onAbort?.();
      },
   });

   return new Response(stream, {
      status: 200,
      headers: {
         'content-type': 'text/event-stream; charset=utf-8',
         // Loopback only, but proxies and dev tooling still honour these.
         'cache-control': 'no-cache, no-transform',
         connection: 'keep-alive',
         // Defensive: stop any intermediary buffering the stream into one chunk.
         'x-accel-buffering': 'no',
      },
   });
}

/** Parse an SSE body back into events. Used by the tests, and by nothing else. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEventT> {
   const reader = body.getReader();
   const decoder = new TextDecoder();
   let buffer = '';

   for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split: number;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
         const chunk = buffer.slice(0, split);
         buffer = buffer.slice(split + 2);
         const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
         if (dataLine) yield JSON.parse(dataLine.slice(6)) as StreamEventT;
      }
   }
}
