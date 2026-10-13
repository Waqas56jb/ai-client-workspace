import pg from 'pg';
import { env } from './env.js';

/**
 * Database access.
 *
 * Every application query runs inside a transaction that:
 *   1. sets the verified user's id as the JWT `sub` claim (so auth.uid() works), and
 *   2. marks the transaction as coming from this API (`ai_workspace.via_api`,
 *      required by ai_workspace_is_member(), so Supabase's Data API cannot
 *      reach application tables with a member's token — migration 0004), and
 *   3. switches to the `authenticated` role,
 * so Supabase Row Level Security policies are enforced on ALL application data
 * access, in addition to the API's own authorisation checks.
 *
 * The adapter interface ({ withUser, withSystem, ping, close }) is implemented
 * by `createPgDatabase` (production) and by an in-process PGlite adapter in tests.
 */

/** @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number }> }} Tx */

function poolConfig() {
  const base = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : { host: env.DATABASE_HOST, port: env.DATABASE_PORT || 6543, database: env.DATABASE_NAME, user: env.DATABASE_USER, password: env.DATABASE_PASSWORD };
  return {
    ...base,
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'ai_workspace_api',
  };
}

export function createPgDatabase() {
  const pool = new pg.Pool(poolConfig());
  pool.on('error', () => {
    /* idle client errors are surfaced on next checkout */
  });

  async function run(fn, setup) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await setup(client);
      const result = await fn({ query: (sql, params) => client.query(sql, params) });
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    /** Run `fn(tx)` as an authenticated workspace user (RLS enforced). */
    withUser(userId, fn) {
      return run(fn, async (c) => {
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await c.query(
          `select set_config('request.jwt.claim.sub', $1, true),
                  set_config('request.jwt.claims', $2, true),
                  set_config('request.jwt.claim.role', 'authenticated', true),
                  set_config('ai_workspace.via_api', 'on', true)`,
          [userId, claims],
        );
        await c.query('set local role authenticated');
      });
    },
    /**
     * Privileged path for controlled server operations only (membership lookup
     * during authentication, readiness checks). Never used for user data writes.
     */
    withSystem(fn) {
      return run(fn, async () => {});
    },
    async ping() {
      const c = await pool.connect();
      try {
        await c.query('select 1');
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}

let instance = null;
export function getDatabase() {
  if (!instance) instance = createPgDatabase();
  return instance;
}
export function setDatabase(db) {
  instance = db;
}
