/**
 * Server-side bounds.
 *
 * The property under test is that an oversized or ill-formed request is
 * refused *before* the server allocates for it. A contract `maxLength` is not a
 * memory bound — TypeBox rejects an oversized string only once it exists — so
 * these assert the guard that runs ahead of body parsing.
 *
 * Each test is written as an attack: send the request that would make the
 * server allocate, and assert it does not get the chance.
 */

import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { newSessionToken } from '@rudra/shared/ids';
import { MAX_REQUEST_BODY_BYTES } from '@rudra/shared/limits';
import { startServer, type StartedServer } from '../src/index.ts';

const TOKEN = newSessionToken();
let server: StartedServer;
let base: string;

beforeAll(() => {
   server = startServer({ token: TOKEN });
   base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
   await server.stop();
});

function authed(extra: Record<string, string> = {}): Record<string, string> {
   return { authorization: `Bearer ${TOKEN}`, ...extra };
}

/** How long to wait for a reply on a raw socket before giving up. */
const RAW_REPLY_TIMEOUT_MS = 2_000;

/** HTTP's line ending. Spelled out once, because these tests write HTTP by hand. */
const CRLF = '\r\n';

/**
 * Send a hand-written HTTP request over a raw socket and return the reply.
 *
 * `fetch` cannot be used for the malformed-header tests: `content-length` is a
 * forbidden header name, so a client is *supposed* to ignore an attempt to set
 * it — and Bun's does so on Linux and macOS while letting it through on
 * Windows. A test built on `fetch` therefore asserts the platform's header
 * sanitising, not our guard, and passes on exactly one of the three OSes CI
 * runs. A socket sends the bytes we wrote, everywhere.
 *
 * Returns the status line, or `null` if the peer closed without replying —
 * which is also a refusal, and is asserted as one.
 */
async function rawRequest(request: string): Promise<string | null> {
   let reply = '';
   // Definite assignment: a Promise executor runs synchronously, so `settle` is
   // assigned before `replied` is awaited.
   let settle!: (value: string | null) => void;
   const replied = new Promise<string | null>((resolve) => {
      settle = resolve;
   });

   const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: server.port,
      socket: {
         data: (_socket, chunk) => {
            reply += new TextDecoder().decode(chunk);
            // The status line is all these tests need, and waiting for the body
            // would hang on a streaming 200.
            if (reply.includes(CRLF)) settle(reply);
         },
         close: () => {
            settle(reply === '' ? null : reply);
         },
         error: () => {
            settle(reply === '' ? null : reply);
         },
      },
   });

   const timer = setTimeout(() => {
      settle(reply === '' ? null : reply);
   }, RAW_REPLY_TIMEOUT_MS);

   socket.write(request);
   const result = await replied;
   clearTimeout(timer);
   socket.end();

   return result === null ? null : (result.split(CRLF)[0] ?? null);
}

/** One request, built byte for byte. `headers` is sent exactly as given. */
function rawPost(headers: readonly string[], body: string): string {
   return ['POST /chat/echo HTTP/1.1', 'Host: 127.0.0.1', ...headers, '', body].join(CRLF);
}

describe('request bodies are bounded before they are read', () => {
   it('refuses a body larger than the ceiling with 413', async () => {
      // `content-length` is set by fetch from the body, so this is the real
      // shape of the attack rather than a hand-forged header.
      const res = await fetch(`${base}/chat/echo`, {
         method: 'POST',
         headers: authed({ 'content-type': 'application/json' }),
         body: JSON.stringify({ message: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1024) }),
      });

      expect(res.status).toBe(413);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe('invalid');
      expect(body.message).toContain(String(MAX_REQUEST_BODY_BYTES));
   });

   it('refuses a body that declares no length with 411', async () => {
      // No `content-length` means chunked, which nothing we serve uses. Reading
      // it would mean streaming an unknown quantity into memory to find out how
      // much there was.
      const res = await fetch(`${base}/chat/echo`, {
         method: 'POST',
         headers: authed({ 'content-type': 'application/json' }),
         // A ReadableStream body makes fetch use chunked transfer encoding.
         body: new ReadableStream<Uint8Array>({
            start(controller) {
               controller.enqueue(new TextEncoder().encode('{"message":"hi"}'));
               controller.close();
            },
         }),
         // Required by fetch when the body is a stream.
         duplex: 'half',
      } as RequestInit);

      expect(res.status).toBe(411);
   });

   // Each of these is a length a body cannot have. The guard in `app.ts` rejects
   // them, and Bun's own HTTP parser rejects most of them a layer earlier — the
   // property under test is that the request is refused either way, never read.
   const BAD_LENGTHS = ['not-a-number', '-1', '99999999999999999999', ''] as const;

   for (const declared of BAD_LENGTHS) {
      it(`refuses a content-length of ${JSON.stringify(declared)}`, async () => {
         // Hand-forged over a socket, because no client sends this by accident
         // and no client can be made to send it on purpose. See `rawRequest`.
         const status = await rawRequest(
            rawPost(
               [
                  `Authorization: Bearer ${TOKEN}`,
                  'Content-Type: application/json',
                  `Content-Length: ${declared}`,
               ],
               '{"message":"hi"}',
            ),
         );

         // A closed connection is a refusal too, and an acceptable one.
         if (status === null) return;
         expect(status).toMatch(/^HTTP\/1\.1 4\d\d /);
      });
   }

   it('accepts an honest content-length over the same raw socket', async () => {
      // The control. Without it the four tests above would also pass against a
      // server that refused everything.
      const body = '{"message":"hi","delayMs":0}';
      const status = await rawRequest(
         rawPost(
            [
               `Authorization: Bearer ${TOKEN}`,
               'Content-Type: application/json',
               `Content-Length: ${new TextEncoder().encode(body).length}`,
            ],
            body,
         ),
      );

      expect(status).toBe('HTTP/1.1 200 OK');
   });

   it('still accepts a normal body', async () => {
      // The bound is only safe if it cannot reject real traffic.
      const res = await fetch(`${base}/chat/echo`, {
         method: 'POST',
         headers: authed({ 'content-type': 'application/json' }),
         body: JSON.stringify({ message: 'hello', delayMs: 0 }),
      });

      expect(res.status).toBe(200);
      await res.body?.cancel();
   });

   it('checks auth before size, so an unauthenticated caller learns nothing', async () => {
      // Ordering matters: an oversized body from an unauthenticated caller must
      // come back 401, not 413. A differing status would confirm the route
      // exists and reveal the limit.
      const res = await fetch(`${base}/chat/echo`, {
         method: 'POST',
         headers: { 'content-type': 'application/json' },
         body: JSON.stringify({ message: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1024) }),
      });

      expect(res.status).toBe(401);
   });

   it('leaves GET requests alone', async () => {
      const res = await fetch(`${base}/health`, { headers: authed() });
      expect(res.status).toBe(200);
   });

   /**
    * The guard refuses a request without reading its body — that is its job.
    * The cost of doing so is that the unread body is still arriving on the
    * connection, and a server that keeps that connection alive parses those
    * leftover bytes as the next request. The refusal then breaks a request that
    * had nothing wrong with it.
    *
    * So each refusal is followed here by a *good* request on the same pooled
    * connection, asserting the refusal was self-contained.
    */
   describe('a refusal never breaks the next request on the connection', () => {
      async function goodRequest(): Promise<number> {
         const res = await fetch(`${base}/chat/echo`, {
            method: 'POST',
            headers: authed({ 'content-type': 'application/json' }),
            body: JSON.stringify({ message: 'hello', delayMs: 0 }),
         });
         await res.body?.cancel();
         return res.status;
      }

      it('after a 413 for an oversized body', async () => {
         const refused = await fetch(`${base}/chat/echo`, {
            method: 'POST',
            headers: authed({ 'content-type': 'application/json' }),
            body: JSON.stringify({ message: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1024) }),
         });
         await refused.body?.cancel();
         expect(refused.status).toBe(413);

         expect(await goodRequest()).toBe(200);
      });

      it('after a 411 for a chunked body', async () => {
         // This is the case that actually regressed: the body is chunked, so
         // the server cannot know how much to skip, and reusing the connection
         // made the *next* request fail with a spurious 400.
         const refused = await fetch(`${base}/chat/echo`, {
            method: 'POST',
            headers: authed({ 'content-type': 'application/json' }),
            body: new ReadableStream<Uint8Array>({
               start(controller) {
                  controller.enqueue(new TextEncoder().encode('{"message":"hi"}'));
                  controller.close();
               },
            }),
            duplex: 'half',
         } as RequestInit);
         await refused.body?.cancel();
         expect(refused.status).toBe(411);

         expect(await goodRequest()).toBe(200);
      });

      it('after a 401 for a body sent without a token', async () => {
         const refused = await fetch(`${base}/chat/echo`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'hello' }),
         });
         await refused.body?.cancel();
         expect(refused.status).toBe(401);

         expect(await goodRequest()).toBe(200);
      });
   });
});
