/**
 * Process lifecycle.
 *
 * PLAN.MD §8: "the sidecar dies with its parent." An orphaned sidecar is a
 * process holding an open port, a SQLite WAL, and shell access, with nothing
 * watching it. Three independent death signals, because each one fails on some
 * platform or in some crash mode:
 *
 *  1. **stdin EOF** — the most reliable. When the parent dies, the pipe closes.
 *     Works on Windows, where there is no parent-death signal.
 *  2. **ppid polling** — catches a parent that died without closing the pipe
 *     (SIGKILL with inherited handles).
 *  3. **SIGINT/SIGTERM** — an orderly shutdown from a supervisor or the shell.
 *
 * Shutdown itself must be idempotent: all three can fire at once.
 */

import { createLogger } from '@rudra/shared/logger';

const log = createLogger('lifecycle');

const PPID_POLL_MS = 2_000;

export type ShutdownReason = 'stdin-closed' | 'parent-gone' | 'signal' | 'requested' | 'fatal';

export interface LifecycleOptions {
   /**
    * The pid to watch. The Flutter shell passes `RUDRA_PARENT_PID`; when it is
    * absent (a developer running `bun dev` by hand) ppid polling is skipped.
    */
   parentPid?: number | undefined;
   /** Run teardown. Called at most once. Must not throw. */
   onShutdown: (reason: ShutdownReason) => Promise<void> | void;
   /** Watch stdin for EOF. Disabled in tests, which have no parent pipe. */
   watchStdin?: boolean;
}

/** Is `pid` still alive? Signal 0 checks existence without delivering anything. */
export function isAlive(pid: number): boolean {
   try {
      globalThis.process.kill(pid, 0);
      return true;
   } catch (cause) {
      // EPERM means it exists but belongs to someone else — still alive.
      return (cause as { code?: string } | null)?.code === 'EPERM';
   }
}

export function installLifecycle(options: LifecycleOptions): {
   shutdown: (r: ShutdownReason) => void;
} {
   let shuttingDown = false;
   let ppidTimer: ReturnType<typeof setInterval> | undefined;

   const shutdown = (reason: ShutdownReason): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info('shutting down', { reason });

      if (ppidTimer !== undefined) clearInterval(ppidTimer);

      void (async () => {
         try {
            await options.onShutdown(reason);
         } catch (cause) {
            log.exception('teardown failed', cause);
         } finally {
            // A failed teardown still exits. Hanging is worse than an unclean close.
            globalThis.process.exit(reason === 'fatal' ? 1 : 0);
         }
      })();
   };

   // 1. stdin EOF — the parent's pipe closed.
   if (options.watchStdin !== false) {
      const stdin = globalThis.process.stdin;
      stdin.on('end', () => {
         shutdown('stdin-closed');
      });
      stdin.on('close', () => {
         shutdown('stdin-closed');
      });
      stdin.on('error', () => {
         shutdown('stdin-closed');
      });
      // Resume so 'end' can actually fire; we read nothing from stdin.
      stdin.resume();
   }

   // 2. ppid polling — the parent died without closing the pipe.
   if (options.parentPid !== undefined && Number.isInteger(options.parentPid)) {
      const pid = options.parentPid;
      if (!isAlive(pid)) {
         log.warn('parent already gone at startup', { parentPid: pid });
         // Defer so the caller can finish wiring before we exit.
         setTimeout(() => {
            shutdown('parent-gone');
         }, 0);
      } else {
         ppidTimer = setInterval(() => {
            if (!isAlive(pid)) shutdown('parent-gone');
         }, PPID_POLL_MS);
         // Do not hold the event loop open just to watch the parent.
         ppidTimer.unref();
      }
   }

   // 3. Signals.
   for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      globalThis.process.on(signal, () => {
         shutdown('signal');
      });
   }

   // A crash is still a shutdown: close the DB rather than leaving a hot WAL.
   globalThis.process.on('uncaughtException', (cause) => {
      log.exception('uncaught exception', cause);
      shutdown('fatal');
   });
   globalThis.process.on('unhandledRejection', (cause) => {
      log.exception('unhandled rejection', cause);
      shutdown('fatal');
   });

   return { shutdown };
}

/**
 * Parse `RUDRA_PARENT_PID`.
 *
 * Note it is NOT read from `process.ppid`: Bun may be launched through a shim,
 * making the direct parent a shell rather than the Flutter shell. The shell
 * tells us which pid actually matters.
 */
export function parentPidFromEnv(): number | undefined {
   const raw = globalThis.process.env['RUDRA_PARENT_PID'];
   if (raw === undefined || raw.trim() === '') return undefined;
   const parsed = Number.parseInt(raw, 10);
   return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
