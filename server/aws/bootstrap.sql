-- Own PostgreSQL (AWS RDS) instead of Supabase: creates what Supabase provides and
-- the application migrations rely on — the auth schema (sign-in accounts), the
-- `authenticated`/`anon` roles used by Row Level Security, auth.uid(), and an empty
-- storage schema (files live in S3; migration 0003 only registers a bucket row).
-- Run once, before `npm run db:migrate -- --apply`. Safe to run again.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
-- the API connects as the database owner and switches to `authenticated` per transaction
grant authenticated to current_user;
grant anon to current_user;

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  encrypted_password text,                       -- bcrypt
  banned_until       timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  last_sign_in_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists auth_users_email_key on auth.users (lower(email));

-- Refresh tokens: only a SHA-256 hash is stored; each refresh rotates the token.
create table if not exists auth.refresh_tokens (
  token_hash text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_refresh_tokens_user_idx on auth.refresh_tokens (user_id);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- RLS policies call auth.uid(); the account tables themselves stay private to the API owner.
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
revoke all on auth.users, auth.refresh_tokens from authenticated, anon;
grant usage on schema public to authenticated, anon;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
