/**
 * GET /health
 *
 * The Flutter shell polls this after the handshake to know the sidecar is
 * actually serving, not merely spawned. It is guarded like every other route:
 * the shell has the token, and nothing else should be probing us.
 */

import { Elysia } from 'elysia';
import { HealthResponse, PROTOCOL_VERSION } from '@rudra/contracts';
import { VERSION } from '../version.ts';

const startedAt = Date.now();

export const healthRoutes = new Elysia().get(
   '/health',
   () => ({
      ok: true as const,
      version: VERSION,
      uptime: (Date.now() - startedAt) / 1000,
      protocol: PROTOCOL_VERSION,
   }),
   { response: HealthResponse },
);
