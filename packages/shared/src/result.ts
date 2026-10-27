/**
 * Typed results. Nothing in Rudra throws a bare string.
 *
 * Rule (MAP.txt): a failure is a value with a code, not an exception with a
 * message. Exceptions are reserved for genuine bugs — a thrown value crossing a
 * route boundary means we missed a case, and `errors.ts` reports it as such.
 */

/** Stable, machine-readable failure codes. The UI may branch on these. */
export const ErrorCode = {
   /** The request body or params did not match the contract. */
   Invalid: 'invalid',
   /** Missing or wrong bearer token. */
   Unauthorized: 'unauthorized',
   /** Asked for something that does not exist. */
   NotFound: 'not_found',
   /** A tool or path was refused by policy (allowlist, confirmation). */
   Forbidden: 'forbidden',
   /** The caller cancelled; not an error condition, but not a success either. */
   Cancelled: 'cancelled',
   /** An upstream provider failed. */
   Upstream: 'upstream',
   /** Disk, DB, or process failure. */
   Internal: 'internal',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The one error shape. Every failure the client can see looks like this. */
export interface AppError {
   readonly code: ErrorCode;
   /** Human-readable, safe to show. Never contains secrets or raw stack traces. */
   readonly message: string;
   /** Optional structured context for the UI (e.g. which field was invalid). */
   readonly detail?: Readonly<Record<string, unknown>>;
   /** Set when this error wraps a thrown value. Logged, never serialised out. */
   readonly cause?: unknown;
}

export interface Ok<T> {
   readonly ok: true;
   readonly value: T;
}

export interface Err<E> {
   readonly ok: false;
   readonly error: E;
}

export type Result<T, E = AppError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
   return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
   return { ok: false, error };
}

/** Build an AppError without repeating the shape at every call site. */
export function appError(
   code: ErrorCode,
   message: string,
   extra?: { detail?: Readonly<Record<string, unknown>>; cause?: unknown },
): AppError {
   return {
      code,
      message,
      ...(extra?.detail !== undefined ? { detail: extra.detail } : {}),
      ...(extra?.cause !== undefined ? { cause: extra.cause } : {}),
   };
}

/** Shorthand for the common failures. */
export const fail = {
   invalid: (message: string, detail?: Readonly<Record<string, unknown>>) =>
      err(appError(ErrorCode.Invalid, message, detail ? { detail } : undefined)),
   unauthorized: (message = 'Missing or invalid token.') =>
      err(appError(ErrorCode.Unauthorized, message)),
   notFound: (message: string) => err(appError(ErrorCode.NotFound, message)),
   forbidden: (message: string) => err(appError(ErrorCode.Forbidden, message)),
   cancelled: (message = 'Cancelled.') => err(appError(ErrorCode.Cancelled, message)),
   upstream: (message: string, cause?: unknown) =>
      err(appError(ErrorCode.Upstream, message, cause !== undefined ? { cause } : undefined)),
   internal: (message: string, cause?: unknown) =>
      err(appError(ErrorCode.Internal, message, cause !== undefined ? { cause } : undefined)),
} as const;

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
   return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
   return !r.ok;
}

/** Map the success value, leaving a failure untouched. */
export function mapOk<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
   return r.ok ? ok(f(r.value)) : r;
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
   return r.ok ? r.value : fallback;
}

/**
 * Run a throwing function and capture any exception as an AppError.
 * Use at the boundary with code we do not control (fs, JSON, a provider SDK).
 */
export function attempt<T>(f: () => T, message: string): Result<T> {
   try {
      return ok(f());
   } catch (cause) {
      return fail.internal(message, cause);
   }
}

export async function attemptAsync<T>(f: () => Promise<T>, message: string): Promise<Result<T>> {
   try {
      return ok(await f());
   } catch (cause) {
      return fail.internal(message, cause);
   }
}

/** Narrow an unknown thrown value to a readable string for logging. */
export function describeCause(cause: unknown): string {
   if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
   if (typeof cause === 'string') return cause;
   try {
      return JSON.stringify(cause);
   } catch {
      return String(cause);
   }
}

/**
 * An `AppError` travelling as an exception.
 *
 * Nothing in Rudra throws where it could return a `Result` — but an async
 * generator is the one place that rule cannot reach. A streaming provider
 * yields events, and "the stream died" is not an event the consumer should
 * have to pattern-match on; a throw is what unwinds the `for await` and runs
 * the `finally` that closes the socket.
 *
 * So the failure still travels as a typed value, wrapped in a real `Error` so
 * it carries a stack and answers to `instanceof`. Throwing a bare object loses
 * both, and `catch (e) { e.message }` on one is how you get `undefined` in a
 * log at three in the morning.
 */
export class AppErrorException extends Error {
   constructor(readonly error: AppError) {
      super(error.message);
      this.name = 'AppErrorException';
   }
}

/** Throw an `AppError`. Returns `never`, so it satisfies exhaustiveness checks. */
export function throwApp(error: AppError): never {
   throw new AppErrorException(error);
}

/**
 * Recover the `AppError` from a caught value.
 *
 * Returns an `internal` error for anything that is not one of ours, so a
 * caller never has to decide what an unknown throw means.
 */
export function toAppError(cause: unknown): AppError {
   if (cause instanceof AppErrorException) return cause.error;
   return appError(ErrorCode.Internal, 'Unexpected failure.', { cause });
}
