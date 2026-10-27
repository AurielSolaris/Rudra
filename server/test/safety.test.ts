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

   it('refuses a malformed content-length with 400', async () => {
      // Hand-forged, because no client sends this by accident.
      const res = await fetch(`${base}/chat/echo`, {
         method: 'POST',
         headers: authed({
            'content-type': 'application/json',
            'content-length': 'not-a-number',
         }),
         body: JSON.stringify({ message: 'hi' }),
      });

      expect([400, 411]).toContain(res.status);
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
});
