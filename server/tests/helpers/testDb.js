// Isolated, in-process PostgreSQL (PGlite) for tests. Never touches Supabase.
// Stubs the minimal parts of Supabase's `auth` and `storage` schemas that the
// migrations reference, then applies the real migration files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../supabase/migrations');

const SUPABASE_STUB = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant usage on schema public to authenticated, anon;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
-- An unrelated project's table and bucket that must survive untouched
create table if not exists public.other_project_clients (id serial primary key, name text);
insert into public.other_project_clients (name) values ('must-survive');
insert into storage.buckets (id, name, public) values ('other_project_bucket', 'other_project_bucket', true) on conflict do nothing;
`;

export function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: f, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }));
}

export async function createTestDb({ migrate = true } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  if (migrate) {
    for (const m of migrationFiles()) await db.exec(m.sql);
  }
  return db;
}

/** Runs `fn(tx)` as the given auth user under the `authenticated` role (RLS applies). */
export async function asUser(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('ai_workspace.via_api', 'on', true)`, [userId || '']);
    await tx.query('set local role authenticated');
    return fn(tx);
  });
}

/** Creates an auth user + active workspace profile (as the superuser, like provisioning). */
export async function provisionUser(db, { id, email, name = 'Test User', active = true }) {
  await db.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [id, email]);
  await db.query(
    `insert into public.ai_workspace_users (id, display_name, email, is_active) values ($1, $2, $3, $4)
     on conflict (id) do update set is_active = excluded.is_active`,
    [id, name, email, active],
  );
}
