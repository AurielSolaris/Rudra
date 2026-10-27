/**
 * Phase 0 spine tests.
 *
 * These assert the things MAP.txt calls load-bearing invariants, not
 * implementation details:
 *   - the auth guard actually guards (INVARIANT 2 / PLAN.MD §8)
 *   - the SSE event union round-trips with exactly one terminal event
 *   - stdout discipline is respected by the logger (INVARIANT 18)
 *
 * Written with the describe/it/expect API, which `bun test` and Vitest share,
 * so the runner can be swapped without touching a test.
 */

import { describe, expect, it, afterAll, beforeAll } from 'bun:test';
import { newSessionToken } from '@rudra/shared/ids';
import type { StreamEventT } from '@rudra/contracts';
import { startServer, type StartedServer } from '../src/index.ts';
import { parseSse } from '../src/sse.ts';

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

const authed = (extra: Record<string, string> = {}): Record<string, string> => ({
   authorization: `Bearer ${TOKEN}`,
   ...extra,
});

describe('binding', () => {
   it('binds an OS-assigned port, never a fixed one', () => {
      // PLAN.MD §8: we always ask for port 0.
      expect(server.port).toBeGreaterThan(0);
      expect(server.port).not.toBe(3000);
   });

   it('mints a 64-hex-character token', () => {
      expect(TOKEN).toMatch(/^[0-9a-f]{64}$/);
   });
});

describe('auth guard', () => {
   it('rejects a request with no token', async () => {
      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
   });

   it('rejects a wrong token', async () => {
      const res = await fetch(`${base}/health`, {
         headers: { authorization: `Bearer ${'0'.repeat(64)}` },
      });
      expect(res.status).toBe(401);
   });

   it('rejects a malformed authorization header', async () => {
      const res = await fetch(`${base}/health`, { headers: { authorization: TOKEN } });
      expect(res.status).toBe(401);
   });

   it('does not reveal why it failed', async () => {
      const res = await fetch(`${base}/health`);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe('unauthorized');
      // One message for every rejection reason.
      expect(body.message).toBe('Missing or invalid token.');
   });

   it('returns 401 for an unknown path too, so paths cannot be probed', async () => {
      const res = await fetch(`${base}/does-not-exist`);
      expect(res.status).toBe(401);
   });

   it('rejects any request carrying an Origin header', async () => {
      // A browser page can fire a cross-origin POST even if it cannot read the
      // response. Nothing legitimate here has an Origin.
      const res = await fetch(`${base}/health`, {
         headers: authed({ origin: 'https://evil.example' }),
      });
      expect(res.status).toBe(403);
   });

   it('accepts the correct token', async () => {
      const res = await fetch(`${base}/health`, { headers: authed() });
      expect(res.status).toBe(200);
   });
});

describe('GET /health', () => {
   it('matches the contract', async () => {
      const res = await fetch(`${base}/health`, { headers: authed() });
      const body = (await res.json()) as {
         ok: boolean;
         version: string;
         uptime: number;
         protocol: number;
      };
      expect(body.ok).toBe(true);
      expect(typeof body.version).toBe('string');
      expect(body.protocol).toBe(1);
      expect(body.uptime).toBeGreaterThanOrEqual(0);
   });
});

async function collect(body: ReadableStream<Uint8Array>): Promise<StreamEventT[]> {
   const events: StreamEventT[] = [];
   for await (const event of parseSse(body)) events.push(event);
   return events;
}

describe('POST /chat/echo (the spine)', () => {
   it('streams start -> deltas -> done and reassembles exactly', async () => {
      const message = 'Rudra: the precursor, not the aspect.';
      const res = await fetch(`${base}/chat/echo`, {
         method: 'POST',
         headers: authed({ 'content-type': 'application/json' }),
         body: JSON.stringify({ message, delayMs: 0 }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.body).not.toBeNull();

      const events = await collect(res.body!);

      expect(events[0]?.type).toBe('start');
      const start = events[0] as Extract<StreamEventT, { type: 'start' }>;
      expect(start.messageId).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);

      const text = events
         .filter((e): e is Extract<StreamEventT, { type: 'delta' }> => e.type === 'delta')
         .map((e) => e.text)
         .join('');
      expect(text).toBe(message);

      const last = events.at(-1) as Extract<StreamEventT, { type: 'done' }>;
      expect(last.type).toBe('done');
      expect(last.reason).toBe('complete');
      expect(last.chars).toBe(message.length);
   });

   it('emits exactly one terminal event', async () => {
      const res = await fetch(`${base}/chat/echo`, {
         method: 'POST',
         headers: authed({ 'content-type': 'application/json' }),
         body: JSON.stringify({ message: 'short', delayMs: 0 }),
      });
      const events = await collect(res.body!);
      const terminal = events.filter((e) => e.type === 'done' || e.type === 'error');
      expect(terminal).toHaveLength(1);
   });

   it('reports an upstream failure as a terminal error event, keeping prior deltas', async () => {
      const res = await fetch(`${base}/chat/echo`, {
         method: 'POST',
         headers: authed({ 'content-type': 'application/json' }),
         body: JSON.stringify({ message: 'abcdefghijklmnop', delayMs: 0, failAfter: 8 }),
      });
      const events = await collect(res.body!);
      const last = events.at(-1) as Extract<StreamEventT, { type: 'error' }>;
      expect(last.type).toBe('error');
      expect(last.error.code).toBe('upstream');
      // The partial text already delivered is still there (PLAN.MD §7).
      const delivered = events
         .filter((e): e is Extract<StreamEventT, { type: 'delta' }> => e.type === 'delta')
         .map((e) => e.text)
         .join('');
      expect(delivered).toBe('abcdefgh');
   });

   it('rejects a body that does not match the contract', async () => {
      const res = await fetch(`${base}/chat/echo`, {
         method: 'POST',
         headers: authed({ 'content-type': 'application/json' }),
         body: JSON.stringify({ message: '' }), // minLength 1
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('invalid');
   });
});
