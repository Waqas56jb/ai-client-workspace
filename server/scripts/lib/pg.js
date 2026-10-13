import 'dotenv/config';
import pg from 'pg';

/**
 * Direct Postgres connection for operator scripts (inspection, migrations,
 * seeding). Uses the Supabase SESSION pooler (port DATABASE_MIGRATION_PORT,
 * default 5432) because multi-statement DDL needs a dedicated session.
 * Credentials come from the environment only — never from arguments or code.
 */
export function createScriptClient() {
  const {
    DATABASE_URL, DATABASE_MIGRATION_URL, DATABASE_HOST, DATABASE_MIGRATION_PORT = '5432',
    DATABASE_NAME = 'postgres', DATABASE_USER, DATABASE_PASSWORD, DATABASE_SSL = 'true',
  } = process.env;
  const ssl = DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false };
  if (DATABASE_MIGRATION_URL || DATABASE_URL) {
    return new pg.Client({ connectionString: DATABASE_MIGRATION_URL || DATABASE_URL, ssl, application_name: 'ai_workspace_scripts' });
  }
  if (!DATABASE_HOST || !DATABASE_USER || !DATABASE_PASSWORD) {
    throw new Error('Set DATABASE_HOST, DATABASE_USER and DATABASE_PASSWORD (or DATABASE_MIGRATION_URL) in server/.env');
  }
  return new pg.Client({
    host: DATABASE_HOST, port: Number(DATABASE_MIGRATION_PORT), database: DATABASE_NAME,
    user: DATABASE_USER, password: DATABASE_PASSWORD, ssl, application_name: 'ai_workspace_scripts',
  });
}
