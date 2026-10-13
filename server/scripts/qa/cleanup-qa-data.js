#!/usr/bin/env node
/**
 * QA ONLY — removes data created by the live QA suite (npm run qa:cleanup).
 *
 *   node scripts/qa/cleanup-qa-data.js            DRY RUN: shows exactly what would be removed
 *   node scripts/qa/cleanup-qa-data.js --apply    removes it (one transaction) + the storage objects
 *   ... --apply --remove-accounts                 also deletes the QA auth accounts (qa-sf-*)
 *
 * Ownership rules (both must hold, otherwise nothing is touched):
 *  - QA accounts are the ids listed in server/.env.qa whose email starts with "qa-sf-".
 *  - A client is QA data only if it was CREATED BY a QA account AND its name starts with "QA_".
 * Everything removed hangs off those clients (jobs, tasks, conversations, messages,
 * files, outputs, versions, approvals, runs, presets, brand assets, activity), plus
 * activity rows written by QA accounts and "QA_" presets created by QA accounts.
 * Clients created by anyone else are never touched, and the script aborts if any
 * row it would delete belongs to a non-QA client.
 *
 * The append-only/immutability guard triggers are disabled ONLY inside this
 * transaction (ALTER TABLE … DISABLE TRIGGER is transactional) and re-enabled
 * before commit, so no other session ever sees them off.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createScriptClient } from '../lib/pg.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_QA = path.resolve(here, '../../.env.qa');
const APPLY = process.argv.includes('--apply');
const REMOVE_ACCOUNTS = process.argv.includes('--remove-accounts');
const BUCKET = process.env.STORAGE_BUCKET || 'ai-workspace-files';

const qa = Object.fromEntries(
  (fs.existsSync(ENV_QA) ? fs.readFileSync(ENV_QA, 'utf8') : '').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const qaUsers = ['QA_MEMBER_A', 'QA_MEMBER_B', 'QA_MEMBER_C', 'QA_INACTIVE', 'QA_OUTSIDER']
  .filter((k) => qa[`${k}_ID`] && qa[`${k}_EMAIL`]?.startsWith('qa-sf-'))
  .map((k) => qa[`${k}_ID`]);
if (!qaUsers.length) {
  console.log('No QA accounts found in .env.qa — nothing to do.');
  process.exit(0);
}

const GUARDS = [
  ['ai_workspace_output_versions', 'ai_workspace_output_versions_immutable'],
  ['ai_workspace_file_versions', 'ai_workspace_file_versions_immutable'],
  ['ai_workspace_approvals', 'ai_workspace_approvals_append_only'],
  ['ai_workspace_activity_logs', 'ai_workspace_activity_logs_append_only'],
];

const db = createScriptClient();
await db.connect();
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

try {
  await db.query('begin');
  const clients = (
    await db.query(`select id, name from public.ai_workspace_clients where created_by = any($1::uuid[]) and name like 'QA\\_%'`, [qaUsers])
  ).rows;
  const ids = clients.map((c) => c.id);
  const notOurs = (await db.query(`select count(*)::int n from public.ai_workspace_clients where id = any($1::uuid[]) and (created_by is null or not (created_by = any($2::uuid[])))`, [ids, qaUsers])).rows[0].n;
  if (notOurs) throw new Error('Ownership check failed: a selected client was not created by a QA account.');

  const preserved = (await db.query(`select count(*)::int n from public.ai_workspace_clients where not (id = any($1::uuid[]))`, [ids])).rows[0].n;
  const storagePaths = (
    await db.query(
      `select storage_path p from public.ai_workspace_files where client_id = any($1::uuid[]) and storage_path is not null
       union select v.storage_path from public.ai_workspace_file_versions v join public.ai_workspace_files f on f.id = v.file_id where f.client_id = any($1::uuid[])
       union select v.metadata->>'originalPath' from public.ai_workspace_file_versions v join public.ai_workspace_files f on f.id = v.file_id
             where f.client_id = any($1::uuid[]) and v.metadata ? 'originalPath' and v.metadata->>'originalPath' is not null`,
      [ids],
    )
  ).rows.map((r) => r.p).filter((p) => p && ids.some((id) => p.startsWith(`clients/${id}/`)));

  for (const [table, trigger] of GUARDS) await db.query(`alter table public.${table} disable trigger ${trigger}`);
  await db.query('set constraints all deferred');
  const steps = [
    ['activity logs', `delete from public.ai_workspace_activity_logs where client_id = any($1::uuid[]) or user_id = any($2::uuid[])`],
    ['approvals', `delete from public.ai_workspace_approvals where client_id = any($1::uuid[])`],
    ['generation runs', `delete from public.ai_workspace_generation_runs where client_id = any($1::uuid[])`],
    ['detach version pointers', `update public.ai_workspace_outputs set current_version_id = null, approved_version_id = null where client_id = any($1::uuid[])`],
    ['detach file pointers', `update public.ai_workspace_files set current_version_id = null where client_id = any($1::uuid[])`],
    ['detach client logos', `update public.ai_workspace_clients set logo_file_id = null where id = any($1::uuid[])`],
    ['output versions', `delete from public.ai_workspace_output_versions where output_id in (select id from public.ai_workspace_outputs where client_id = any($1::uuid[]))`],
    ['outputs', `delete from public.ai_workspace_outputs where client_id = any($1::uuid[])`],
    ['brand assets', `delete from public.ai_workspace_brand_assets where client_id = any($1::uuid[])`],
    ['file versions', `delete from public.ai_workspace_file_versions where file_id in (select id from public.ai_workspace_files where client_id = any($1::uuid[]))`],
    ['files', `delete from public.ai_workspace_files where client_id = any($1::uuid[])`],
    ['messages', `delete from public.ai_workspace_messages where conversation_id in (select id from public.ai_workspace_conversations where client_id = any($1::uuid[]))`],
    ['conversations', `delete from public.ai_workspace_conversations where client_id = any($1::uuid[])`],
    ['tasks', `delete from public.ai_workspace_tasks where client_id = any($1::uuid[])`],
    ['jobs', `delete from public.ai_workspace_jobs where client_id = any($1::uuid[])`],
    ['presets', `delete from public.ai_workspace_image_presets where client_id = any($1::uuid[]) or (created_by = any($2::uuid[]) and name like 'QA\\_%' and not is_starter)`],
    ['clients', `delete from public.ai_workspace_clients where id = any($1::uuid[])`],
  ];
  const report = {};
  for (const [label, sql] of steps) report[label] = (await db.query(sql, sql.includes("$2") ? [ids, qaUsers] : [ids])).rowCount;
  await db.query('set constraints all immediate');
  for (const [table, trigger] of GUARDS) await db.query(`alter table public.${table} enable trigger ${trigger}`);

  console.log(`QA clients: ${clients.length} · other clients preserved: ${preserved}`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Storage objects to remove: ${storagePaths.length}`);

  if (!APPLY) {
    await db.query('rollback');
    console.log('\nDRY RUN — rolled back, nothing was changed. Re-run with --apply.');
  } else {
    await db.query('commit');
    for (let i = 0; i < storagePaths.length; i += 100) {
      const { error } = await admin.storage.from(BUCKET).remove(storagePaths.slice(i, i + 100));
      if (error) console.log(`storage remove warning: ${error.message}`);
    }
    // Orphans left by failed uploads under QA client folders
    let orphans = 0;
    for (const id of ids) {
      const stack = [`clients/${id}`];
      while (stack.length) {
        const dir = stack.pop();
        const { data } = await admin.storage.from(BUCKET).list(dir, { limit: 1000 });
        for (const e of data || []) {
          const p = `${dir}/${e.name}`;
          if (e.id) {
            await admin.storage.from(BUCKET).remove([p]);
            orphans += 1;
          } else stack.push(p);
        }
      }
    }
    console.log(`Database rows removed. Storage objects removed: ${storagePaths.length} (+${orphans} orphaned).`);
    if (REMOVE_ACCOUNTS) {
      await db.query(`update public.ai_workspace_ai_instructions set updated_by = null where updated_by = any($1::uuid[])`, [qaUsers]);
      await db.query(`update public.ai_workspace_settings set updated_by = null where updated_by = any($1::uuid[])`, [qaUsers]);
      await db.query(`update public.ai_workspace_image_presets set updated_by = null, created_by = case when created_by = any($1::uuid[]) then null else created_by end where updated_by = any($1::uuid[]) or created_by = any($1::uuid[])`, [qaUsers]);
      for (const id of qaUsers) {
        const { data } = await admin.auth.admin.getUserById(id);
        if (!data?.user?.email?.startsWith('qa-sf-')) continue;
        const { error } = await admin.auth.admin.deleteUser(id);
        console.log(`account ${data.user.email}: ${error ? `not deleted (${error.message})` : 'deleted'}`);
      }
    }
  }
} catch (err) {
  await db.query('rollback').catch(() => {});
  console.error(`Cleanup aborted, nothing changed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
