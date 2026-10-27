/**
 * Identifiers.
 *
 * Ids are **lexicographically sortable by creation time** (ULID layout: 48-bit
 * big-endian millisecond timestamp + 80 bits of randomness, Crockford base32).
 * That matters because message ordering is a primary key concern: sortable ids
 * mean `ORDER BY id` is already chronological, and a session's transcript can be
 * paged without a separate sequence column being authoritative.
 *
 * No dependency — ULID is 40 lines and we would rather own them.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

let lastMs = -1;
let lastRandom: Uint8Array = new Uint8Array(10);

function encodeTime(ms: number): string {
   let out = '';
   let n = ms;
   for (let i = TIME_CHARS - 1; i >= 0; i--) {
      out = CROCKFORD.charAt(n % 32) + out;
      n = Math.floor(n / 32);
   }
   return out;
}

function encodeRandom(bytes: Uint8Array): string {
   // 10 bytes = 80 bits -> 16 base32 chars.
   let bits = 0n;
   for (const b of bytes) bits = (bits << 8n) | BigInt(b);
   let out = '';
   for (let i = 0; i < RANDOM_CHARS; i++) {
      out = CROCKFORD.charAt(Number(bits & 31n)) + out;
      bits >>= 5n;
   }
   return out;
}

/** Increment the random block, so ids made in the same millisecond still sort. */
function bumpRandom(bytes: Uint8Array): Uint8Array {
   const next = Uint8Array.from(bytes);
   for (let i = next.length - 1; i >= 0; i--) {
      const current = next[i] ?? 0;
      if (current < 255) {
         next[i] = current + 1;
         return next;
      }
      next[i] = 0;
   }
   // Overflowed 80 bits in one millisecond. Not reachable in practice.
   crypto.getRandomValues(next);
   return next;
}

/** A new sortable id. Monotonic even within a single millisecond. */
export function newId(): string {
   const now = Date.now();
   if (now === lastMs) {
      lastRandom = bumpRandom(lastRandom);
   } else {
      lastMs = now;
      lastRandom = new Uint8Array(10);
      crypto.getRandomValues(lastRandom);
   }
   return encodeTime(now) + encodeRandom(lastRandom);
}

const ID_SHAPE = new RegExp(`^[${CROCKFORD}]{${TIME_CHARS + RANDOM_CHARS}}$`);

export function isValidId(value: string): boolean {
   return ID_SHAPE.test(value);
}

/** The creation time encoded in an id, or null if it is not one of ours. */
export function idTimestamp(id: string): Date | null {
   if (!isValidId(id)) return null;
   let ms = 0;
   for (let i = 0; i < TIME_CHARS; i++) {
      ms = ms * 32 + CROCKFORD.indexOf(id.charAt(i));
   }
   return new Date(ms);
}

/**
 * A session token for the loopback handshake (PLAN.MD §8).
 *
 * 32 bytes of CSPRNG output as hex. Deliberately *not* a ULID: this is a
 * credential, so it carries no timestamp and no structure to reason about.
 */
export function newSessionToken(): string {
   const bytes = new Uint8Array(32);
   crypto.getRandomValues(bytes);
   return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
