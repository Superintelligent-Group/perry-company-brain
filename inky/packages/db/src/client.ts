/**
 * The live Postgres client. A pooled node-postgres connection — works against
 * Neon's pooled endpoint (the Phase 6 target), a local Postgres, Supabase, or RDS
 * unchanged. The long-running worker keeps one pool for the process; the dashboard's
 * API routes can create one per server instance. Connection string from env.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type InkyDb = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: InkyDb;
  /** The underlying pool — call `.end()` on shutdown. */
  pool: Pool;
}

/** Open a pooled connection. Defaults to DATABASE_URL; throws if neither is set. */
export function createDb(connectionString: string | undefined = process.env.DATABASE_URL): DbHandle {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set — the hosted worker/dashboard need a Postgres connection string ' +
        '(e.g. your Neon pooled connection URL).',
    );
  }
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}
