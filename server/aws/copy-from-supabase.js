#!/usr/bin/env node
/**
 * One-off copy of the workspace from Supabase to AWS (READ-ONLY on Supabase).
 *
 *   TARGET_DATABASE_URL=postgres://…rds…/studioflow  S3_BUCKET=…  node aws/copy-from-supabase.js [--apply]
 *
 * Copies:
 *  - the sign-in accounts of workspace members only (auth.users rows whose id is in
 *    ai_workspace_users) with their bcrypt password hashes, so passwords keep working;
 *  - every public.ai_workspace_* table (except the migration log), in one transaction
 *    on the target with triggers/foreign keys deferred via session_replication_role;
 *  - every object of the private Supabase bucket into the S3 bucket (same keys).
 * Other projects' tables, users and buckets on the shared Supabase are never read.
 * Without --apply it only prints what it would copy.
 */
import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createScriptClient } from '../scripts/lib/pg.js';

const APPLY = process.argv.includes('--apply');
const { TARGET_DATABASE_URL, S3_BUCKET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STORAGE_BUCKET = 'ai-workspace-files' } = process.env;
if (!TARGET_DATABASE_URL || !S3_BUCKET) throw new Error('Set TARGET_DATABASE_URL and S3_BUCKET');

const src = createScriptClient();
const dst = new pg.Client({ connectionString: TARGET_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await src.connect();
await dst.connect();
await src.query('begin transaction read only');

const BATCH = 300;
const cols = async (client, table) =>
  (await client.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' and identity_generation is distinct from 'ALWAYS' order by ordinal_position`, [table])).rows.map((r) => r.column_name);

try {
  const tables = (await src.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name like 'ai\\_workspace\\_%' and table_name <> 'ai_workspace_schema_migrations' order by 1`)).rows.map((r) => r.table_name);
  const users = (await src.query(`select a.id, lower(a.email) as email, a.encrypted_password, a.banned_until, coalesce(a.raw_user_meta_data, '{}'::jsonb) as raw_user_meta_data, coalesce(a.raw_app_meta_data, '{}'::jsonb) as raw_app_meta_data, a.last_sign_in_at, a.created_at
      from auth.users a join public.ai_workspace_users u on u.id = a.id`)).rows;
  const counts = {};
  for (const t of tables) counts[t] = (await src.query(`select count(*)::int as n from public.${t}`)).rows[0].n;
  const objects = (await src.query(`select name from storage.objects where bucket_id = $1 order by name`, [STORAGE_BUCKET])).rows.map((r) => r.name);
  console.log(`Accounts: ${users.length} (workspace members only)`);
  Object.entries(counts).forEach(([t, n]) => console.log(`  ${t}: ${n}`));
  console.log(`Files: ${objects.length}`);
  if (!APPLY) {
    console.log('\nDRY RUN — nothing copied. Re-run with --apply.');
    process.exit(0);
  }

  await dst.query('begin');
  await dst.query(`set local session_replication_role = replica`); // skip FK checks and triggers while loading a consistent snapshot
  for (const u of users) {
    await dst.query(
      `insert into auth.users (id, email, encrypted_password, banned_until, raw_user_meta_data, raw_app_meta_data, last_sign_in_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set email = excluded.email, encrypted_password = excluded.encrypted_password,
         banned_until = excluded.banned_until, raw_user_meta_data = excluded.raw_user_meta_data, raw_app_meta_data = excluded.raw_app_meta_data`,
      [u.id, u.email, u.encrypted_password, u.banned_until, u.raw_user_meta_data, u.raw_app_meta_data, u.last_sign_in_at, u.created_at],
    );
  }
  for (const t of tables) {
    const target = new Set(await cols(dst, t));
    const list = (await cols(src, t)).filter((c) => target.has(c));
    const q = list.map((c) => `"${c}"`).join(', ');
    await dst.query(`delete from public.${t}`); // target only — makes a re-run start clean
    for (let offset = 0; offset < counts[t]; offset += BATCH) {
      const { rows } = await src.query(`select coalesce(json_agg(x), '[]') as j from (select ${q} from public.${t} order by 1 limit ${BATCH} offset ${offset}) x`);
      await dst.query(`insert into public.${t} (${q}) select ${q} from json_populate_recordset(null::public.${t}, $1)`, [JSON.stringify(rows[0].j)]);
    }
    const n = (await dst.query(`select count(*)::int as n from public.${t}`)).rows[0].n;
    if (n !== counts[t]) throw new Error(`${t}: copied ${n} of ${counts[t]}`);
    console.log(`✔ ${t}: ${n}`);
  }
  await dst.query('commit');

  const storage = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from(STORAGE_BUCKET);
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-2' });
  let done = 0;
  for (const name of objects) {
    const { data, error } = await storage.download(name);
    if (error) throw new Error(`download ${name}: ${error.message}`);
    await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: name, Body: Buffer.from(await data.arrayBuffer()), ContentType: data.type || 'application/octet-stream' }));
    if (++done % 25 === 0) console.log(`  files ${done}/${objects.length}`);
  }
  console.log(`✔ files: ${done}`);
} catch (err) {
  await dst.query('rollback').catch(() => {});
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  await src.query('rollback').catch(() => {});
  await src.end();
  await dst.end();
}
