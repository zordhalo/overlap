/**
 * The Neon connection, isolated so `queries.ts` (and nothing else) can reach
 * it. Not exported outside `src/lib/db/**` — callers go through
 * `queries.ts`, which is the one module boundary the rest of the app may
 * import.
 *
 * Uses the websocket `Pool` driver, not `neon-http`: `replaceBusyForMember`
 * needs a real transaction (delete-then-insert must be atomic, per the
 * "never silently turn busy into free" rule), and the HTTP driver has no
 * transaction support at all.
 */
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from './schema';

function loadConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set.');
  }
  return url;
}

const pool = new Pool({ connectionString: loadConnectionString() });

export const db = drizzle(pool, { schema });
