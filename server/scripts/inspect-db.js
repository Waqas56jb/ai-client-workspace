#!/usr/bin/env node
/**
 * READ-ONLY database inspection (npm run db:inspect).
 *
 * Runs every query inside a READ ONLY transaction that is rolled back, so it
 * cannot change anything. Reports existing schemas/tables/buckets and any
 * objects that could conflict with this application's `ai_workspace_` names.
 */
import { createScriptClient } from './lib/pg.js';

const client = createScriptClient();
await client.connect();
await client.query('begin transaction read only');

const section = async (title, sql) => {
  const { rows } = await client.query(sql);
  console.log(`\n${title} (${rows.length})`);
  rows.forEach((r) => console.log('  ' + Object.values(r).join(' | ')));
  return rows;
};

try {
  await section('Server', `select version() as version, current_setting('transaction_read_only') as read_only`);
  await section('Schemas', `select nspname from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema' order by 1`);
  const tables = await section('Public tables', `select table_name from information_schema.tables where table_schema = 'public' order by 1`);
  const ours = await section('Application objects (ai_workspace*)', `
    select 'relation' as kind, n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname ilike 'ai_workspace%'
    union all select 'function', n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname ilike 'ai_workspace%'
    union all select 'type', n.nspname || '.' || t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typname ilike 'ai_workspace%' and t.typtype <> 'c'
    union all select 'policy', schemaname || '.' || tablename || ':' || policyname from pg_policies where policyname ilike 'ai_workspace%'
    order by 1, 2`);
  await section('Storage buckets', `select id, public from storage.buckets order by 1`);
  await section('Applied application migrations', `
    select case when to_regclass('public.ai_workspace_schema_migrations') is null then 'none (tracking table not created yet)' else 'see ai_workspace_schema_migrations' end as status`);
  await section('Triggers on auth.users (other projects may rely on these)', `select trigger_name from information_schema.triggers where event_object_schema = 'auth' and event_object_table = 'users'`);
  console.log(`\nSummary: ${tables.length} public tables, ${ours.length} existing ai_workspace objects.`);
} finally {
  await client.query('rollback');
  await client.end();
}
