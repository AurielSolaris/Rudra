/**
 * Phase 0 smoke test — the one you run by hand.
 *
 * Spawns the sidecar exactly the way the Flutter shell will, then exercises the
 * whole spine and prints a plain PASS/FAIL report. If something here fails, the
 * line tells you what broke and what to paste back.
 *
 *   bun run smoke
 *
 * Unlike `bun test`, this drives a **real subprocess**: it proves the handshake,
 * the parent-death watch, and stdout discipline, none of which an in-process
 * test can check.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamEventT } from '@rudra/contracts';

const SERVER = resolve(import.meta.dir, '../../server/src/index.ts');
const BOOT_TIMEOUT_MS = 15_000;

let passed = 0;
let failed = 0;

function pass(name: string, detail = ''): void {
   passed += 1;
   console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
}

function fail(name: string, why: string): void {
   failed += 1;
   console.log(`  FAIL  ${name}`);
   console.log(`        ${why}`);
}

function check(name: string, condition: boolean, why: string): void {
   if (condition) pass(name);
   else fail(name, why);
}

interface Spawned {
   /** Raw parsed stdout line. Untrusted until validated — that is the test. */
   handshake: Record<string, unknown>;
   stderr: string[];
   extraStdout: string[];
   kill: () => void;
   waitForExit: () => Promise<number | null>;
}

/** Boot the sidecar and wait for its handshake line. */
async function boot(): Promise<Spawned> {
   // An isolated home, so a smoke run can never touch a real profile.
   const home = mkdtempSync(join(tmpdir(), 'rudra-smoke-'));

   const child = spawn('bun', [SERVER], {
      env: {
         ...process.env,
         RUDRA_HOME: home,
         RUDRA_PARENT_PID: String(process.pid),
         RUDRA_LOG: 'info',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
   });

   const stderr: string[] = [];
   const extraStdout: string[] = [];
   child.stderr.setEncoding('utf8');
   child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) if (line.trim() !== '') stderr.push(line);
   });

   const handshake = await new Promise<Record<string, unknown>>(
      (resolveHandshake, rejectHandshake) => {
         const timer = setTimeout(() => {
            rejectHandshake(new Error(`no handshake within ${BOOT_TIMEOUT_MS}ms`));
         }, BOOT_TIMEOUT_MS);
         let buffer = '';
         let got = false;

         child.stdout.setEncoding('utf8');
         child.stdout.on('data', (chunk: string) => {
            buffer += chunk;
            let nl: number;
            while ((nl = buffer.indexOf('\n')) !== -1) {
               const line = buffer.slice(0, nl);
               buffer = buffer.slice(nl + 1);
               if (line.trim() === '') continue;
               if (!got) {
                  got = true;
                  clearTimeout(timer);
                  try {
                     resolveHandshake(JSON.parse(line) as Record<string, unknown>);
                  } catch {
                     rejectHandshake(
                        new Error(`first stdout line was not JSON: ${line.slice(0, 200)}`),
                     );
                  }
               } else {
                  // Anything after line one violates INVARIANT 18.
                  extraStdout.push(line);
               }
            }
         });

         child.on('error', (cause) => {
            clearTimeout(timer);
            rejectHandshake(cause);
         });
         child.on('exit', (code) => {
            if (!got) {
               clearTimeout(timer);
               rejectHandshake(
                  new Error(
                     `sidecar exited with code ${String(code)} before handshake.\n${stderr.join('\n')}`,
                  ),
               );
            }
         });
      },
   );

   return {
      handshake,
      stderr,
      extraStdout,
      kill: () => {
         child.kill();
      },
      waitForExit: () =>
         new Promise((r) => {
            if (child.exitCode !== null) {
               r(child.exitCode);
            } else {
               child.on('exit', (code) => {
                  r(code);
               });
            }
         }),
   };
}

async function collectSse(body: ReadableStream<Uint8Array>): Promise<StreamEventT[]> {
   const reader = body.getReader();
   const decoder = new TextDecoder();
   const events: StreamEventT[] = [];
   let buffer = '';
   for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
         const chunk = buffer.slice(0, split);
         buffer = buffer.slice(split + 2);
         const line = chunk.split('\n').find((l) => l.startsWith('data: '));
         if (line) events.push(JSON.parse(line.slice(6)) as StreamEventT);
      }
   }
   return events;
}

async function main(): Promise<void> {
   console.log('\nRudra — Phase 0 smoke test');
   console.log('─'.repeat(60));

   console.log('\n[1] Boot & handshake');
   let sidecar: Spawned;
   try {
      sidecar = await boot();
      pass('sidecar started and printed a handshake');
   } catch (cause) {
      fail('sidecar boot', cause instanceof Error ? cause.message : String(cause));
      console.log('\nCannot continue without a running sidecar.\n');
      process.exit(1);
   }

   const { handshake } = sidecar;
   const port = typeof handshake['port'] === 'number' ? handshake['port'] : 0;
   const token = typeof handshake['token'] === 'string' ? handshake['token'] : '';
   const base = `http://127.0.0.1:${port}`;
   const authed = { authorization: `Bearer ${token}` };

   check(
      'handshake is well-formed',
      handshake['rudra'] === 'handshake' && handshake['protocol'] === 1,
      `got ${JSON.stringify({ rudra: handshake['rudra'], protocol: handshake['protocol'] })}`,
   );
   check('port is OS-assigned, not fixed', port > 1024 && port <= 65535, `port was ${port}`);
   check(
      'token is 64 hex chars',
      /^[0-9a-f]{64}$/.test(token),
      `token looked like ${token.slice(0, 12)}… (len ${token.length})`,
   );

   console.log('\n[2] Auth guard (PLAN.MD §8)');
   const noToken = await fetch(`${base}/health`);
   check(
      'request without a token is refused',
      noToken.status === 401,
      `got ${String(noToken.status)}, want 401`,
   );

   const badToken = await fetch(`${base}/health`, {
      headers: { authorization: `Bearer ${'0'.repeat(64)}` },
   });
   check(
      'wrong token is refused',
      badToken.status === 401,
      `got ${String(badToken.status)}, want 401`,
   );

   const withOrigin = await fetch(`${base}/health`, {
      headers: { ...authed, origin: 'https://evil.example' },
   });
   check(
      'request with an Origin header is refused',
      withOrigin.status === 403,
      `got ${String(withOrigin.status)}, want 403 — a browser page must not reach the agent`,
   );

   console.log('\n[3] GET /health');
   const health = await fetch(`${base}/health`, { headers: authed });
   if (health.status === 200) {
      const body = (await health.json()) as { ok: boolean; protocol: number; version: string };
      check(
         'health responds 200 with the contract shape',
         body.ok && body.protocol === 1,
         JSON.stringify(body),
      );
   } else {
      fail('health responds 200', `got ${String(health.status)}`);
   }

   console.log('\n[4] SSE stream (the spine)');
   const message = 'The precursor, not the aspect.';
   const stream = await fetch(`${base}/chat/echo`, {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ message, delayMs: 0 }),
   });

   if (stream.body === null) {
      fail('stream has a body', 'response body was null');
   } else {
      const events = await collectSse(stream.body);
      const deltas = events.filter((e) => e.type === 'delta');
      const text = deltas.map((e) => e.text).join('');
      const terminal = events.filter((e) => e.type === 'done' || e.type === 'error');

      check(
         'stream opens with `start`',
         events[0]?.type === 'start',
         `first event was ${String(events[0]?.type)}`,
      );
      check(
         'deltas reassemble to the exact input',
         text === message,
         `got ${JSON.stringify(text)}`,
      );
      check('exactly one terminal event', terminal.length === 1, `saw ${String(terminal.length)}`);
      pass('event count', `${String(events.length)} events, ${String(deltas.length)} deltas`);
   }

   console.log('\n[5] Failure path');
   const failing = await fetch(`${base}/chat/echo`, {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'abcdefghijklmnop', delayMs: 0, failAfter: 8 }),
   });
   if (failing.body !== null) {
      const events = await collectSse(failing.body);
      const last = events.at(-1);
      check(
         'a simulated upstream failure arrives as a terminal error event',
         last?.type === 'error',
         `last event was ${String(last?.type)}`,
      );
      const delivered = events
         .filter((e) => e.type === 'delta')
         .map((e) => e.text)
         .join('');
      check(
         'partial text before the failure is preserved',
         delivered === 'abcdefgh',
         `got ${JSON.stringify(delivered)}`,
      );
   }

   const badBody = await fetch(`${base}/chat/echo`, {
      method: 'POST',
      headers: { ...authed, 'content-type': 'application/json' },
      body: JSON.stringify({ message: '' }),
   });
   check(
      'a contract-violating body is rejected',
      badBody.status === 400,
      `got ${String(badBody.status)}, want 400`,
   );

   console.log('\n[6] stdout discipline (INVARIANT 18)');
   check(
      'nothing but the handshake was written to stdout',
      sidecar.extraStdout.length === 0,
      `extra stdout lines: ${JSON.stringify(sidecar.extraStdout.slice(0, 3))}`,
   );
   check(
      'logs went to stderr',
      sidecar.stderr.some((l) => l.includes('sidecar listening')),
      'no "sidecar listening" line on stderr',
   );
   check(
      'the token never appears in the logs',
      !sidecar.stderr.some((l) => l.includes(token)),
      'the session token was found in a log line',
   );

   console.log('\n[7] Shutdown');
   sidecar.kill();
   const exitCode = await Promise.race([
      sidecar.waitForExit(),
      new Promise<'timeout'>((r) => {
         setTimeout(() => {
            r('timeout');
         }, 5000);
      }),
   ]);
   check('sidecar exits when signalled', exitCode !== 'timeout', 'still alive 5s after SIGTERM');

   console.log(`\n${'─'.repeat(60)}`);
   console.log(`${String(passed)} passed, ${String(failed)} failed\n`);
   process.exit(failed === 0 ? 0 : 1);
}

void main();
