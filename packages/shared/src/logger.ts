/**
 * Leveled logger.
 *
 * INVARIANT 18 (MAP.txt): **stdout belongs to the handshake line alone.**
 * The Flutter shell parses the first stdout line as JSON to learn the port and
 * token. A stray `console.log` there corrupts boot. Everything here writes to
 * **stderr**, which the shell captures as the app log.
 */

import { describeCause } from './result.ts';

export const LogLevel = {
   debug: 10,
   info: 20,
   warn: 30,
   error: 40,
   silent: 100,
} as const;

export type LogLevelName = keyof typeof LogLevel;

type Fields = Readonly<Record<string, unknown>>;

function envLevel(): LogLevelName {
   const raw = (globalThis.process.env['RUDRA_LOG'] ?? '').toLowerCase();
   return raw in LogLevel ? (raw as LogLevelName) : 'info';
}

let threshold: number = LogLevel[envLevel()];

export function setLogLevel(name: LogLevelName): void {
   threshold = LogLevel[name];
}

/** Redact values that look like secrets before they reach the log. */
const SECRET_KEY = /^(.*(token|key|secret|password|authorization|bearer).*)$/i;

function redact(fields: Fields): Record<string, unknown> {
   const out: Record<string, unknown> = {};
   for (const [k, v] of Object.entries(fields)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : v;
   }
   return out;
}

function emit(level: LogLevelName, scope: string, msg: string, fields?: Fields): void {
   if (LogLevel[level] < threshold) return;
   const line = {
      t: new Date().toISOString(),
      level,
      scope,
      msg,
      ...(fields ? redact(fields) : {}),
   };
   // stderr, never stdout. See the invariant above.
   globalThis.process.stderr.write(`${JSON.stringify(line)}\n`);
}

export interface Logger {
   debug(msg: string, fields?: Fields): void;
   info(msg: string, fields?: Fields): void;
   warn(msg: string, fields?: Fields): void;
   error(msg: string, fields?: Fields): void;
   /** Log a caught value without leaking a stack trace to the client. */
   exception(msg: string, cause: unknown, fields?: Fields): void;
   child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
   return {
      debug: (msg, fields) => {
         emit('debug', scope, msg, fields);
      },
      info: (msg, fields) => {
         emit('info', scope, msg, fields);
      },
      warn: (msg, fields) => {
         emit('warn', scope, msg, fields);
      },
      error: (msg, fields) => {
         emit('error', scope, msg, fields);
      },
      exception: (msg, cause, fields) => {
         emit('error', scope, msg, {
            ...fields,
            cause: describeCause(cause),
            stack: cause instanceof Error ? cause.stack : undefined,
         });
      },
      child: (sub) => createLogger(`${scope}:${sub}`),
   };
}

export const log = createLogger('rudra');
