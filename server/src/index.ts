/**
 * Sidecar entrypoint.
 *
 * Boot order matters:
 *   1. ensure the profile layout exists on disk
 *   2. mint a session token
 *   3. bind 127.0.0.1 on **port 0** (the OS picks; never a fixed port)
 *   4. print the handshake as ONE line of JSON on stdout
 *   5. serve
 *
 * The handshake is the only thing ever written to stdout (INVARIANT 18). All
 * logging goes to stderr, so the shell can parse line one without racing a log
 * line into the middle of it.
 */

import { createLogger } from '@rudra/shared/logger';
import { newSessionToken } from '@rudra/shared/ids';
import { ensureProfileLayout, rudraHome } from '@rudra/shared/paths';
import { PROTOCOL_VERSION, type HandshakeT } from '@rudra/contracts';
import { createApp } from './app.ts';
import { installLifecycle, parentPidFromEnv } from './lifecycle.ts';
import { VERSION } from './version.ts';

const log = createLogger('boot');

/** Loopback only. Binding 0.0.0.0 would expose shell access to the network. */
const HOST = '127.0.0.1';

export interface StartedServer {
   readonly port: number;
   readonly token: string;
   readonly stop: () => Promise<void>;
}

/**
 * Start the HTTP server.
 *
 * Exported so tests can start one without the handshake-and-exit machinery.
 */
export function startServer(options: { token: string; port?: number }): StartedServer {
   const app = createApp({ token: options.token });

   const server = app.listen({
      hostname: HOST,
      // Port 0 asks the OS for a free port. PLAN.MD §8.
      port: options.port ?? 0,
      // Do not let a stale listener linger and shadow a fresh start.
      reusePort: false,
   });

   const bound = server.server;
   if (bound === null || typeof bound.port !== 'number') {
      throw new Error('Server failed to bind — no port was assigned.');
   }
   const port = bound.port;

   return {
      port,
      token: options.token,
      stop: async () => {
         await server.stop();
      },
   };
}

function printHandshake(handshake: HandshakeT): void {
   // Exactly one line, then flush. Nothing else touches stdout, ever.
   globalThis.process.stdout.write(`${JSON.stringify(handshake)}\n`);
}

function main(): void {
   ensureProfileLayout();

   const token = newSessionToken();
   const started = startServer({ token });

   const handshake: HandshakeT = {
      rudra: 'handshake',
      protocol: PROTOCOL_VERSION,
      version: VERSION,
      port: started.port,
      token,
      pid: globalThis.process.pid,
   };

   printHandshake(handshake);

   // Logged after the handshake, and without the token.
   log.info('sidecar listening', {
      host: HOST,
      port: started.port,
      home: rudraHome(),
      pid: globalThis.process.pid,
   });

   installLifecycle({
      parentPid: parentPidFromEnv(),
      onShutdown: async (reason) => {
         log.info('stopping server', { reason });
         await started.stop();
         // Phase 1 adds: flush autosave buffers, checkpoint the WAL, close both
         // databases (PLAN.MD §7).
      },
   });
}

// Only run when executed directly, so importing this module in a test does not
// bind a port or print a handshake.
if (import.meta.main) {
   main();
}
