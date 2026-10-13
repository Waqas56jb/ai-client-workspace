#!/usr/bin/env node
/**
 * Controlled migration runner.
 *
 *   npm run db:migrate              → DRY RUN: preflight checks + plan, changes nothing
 *   npm run db:migrate -- --apply   → applies pending migrations (each in its own transaction)
 *
 * Safety:
 *  - Static check: refuses files containing DROP/TRUNCATE/DELETE, ALTER of
 *    non-application tables, global config changes, or unprefixed object names.
 *  - Preflight: refuses to run if `ai_workspace_*` tables already exist without
 *    this runner's tracking records (unknown origin), if the bucket id is taken
 *    by a public bucket, or if an applied migration file was modified.
 *  - Never runs automatically on application start.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createScriptClient } from './lib/pg.js';
import { checkMigrationSafety, stripComments } from './lib/migrationSafety.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, '../supabase/migrations');
const APPLY = process.argv.includes('--apply');
const TRACKING = 'public.ai_workspace_schema_migrations';

const files = fs
  .readdirSync(DIR)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort()
  .map((name) => {
    const sql = fs.readFileSync(path.join(DIR, name), 'utf8');
    return { name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
  });

function describe(sql) {
  const body = stripComments(sql);
  const out = [];
  const re = /\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|index|function|trigger|policy)\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi;
  let m;
  while ((m = re.exec(body))) out.push(`${m[1].toLowerCase()} ${m[2]}`);
  if (/insert\s+into\s+storage\.buckets/i.test(body)) out.push('storage bucket ai-workspace-files (private, only if absent)');
  if (/enable\s+row\s+level\s+security/i.test(body)) out.push('row level security on application tables');
  return out;
}

const client = createScriptClient();
await client.connect();
let exitCode = 0;
try {
  // ── Static safety ──────────────────────────────────────────────────────────
  for (const f of files) {
    const problems = checkMigrationSafety(f.sql);
    if (problems.length) throw new Error(`Unsafe migration ${f.name}:\n  - ${problems.join('\n  - ')}`);
  }

  // ── Preflight (read only) ─────────────────────────────────────────────────
  await client.query('begin transaction read only');
  const tracking = (await client.query(`select to_regclass($1) is not null as exists`, [TRACKING])).rows[0].exists;
  const applied = tracking ? (await client.query(`select name, checksum from ${TRACKING}`)).rows : [];
  const existingTables = (await client.query(`select tablename from pg_tables where schemaname = 'public' and tablename like 'ai\\_workspace\\_%' and tablename <> 'ai_workspace_schema_migrations'`)).rows.map((r) => r.tablename);
  const bucket = (await client.query(`select id, public from storage.buckets where id = 'ai-workspace-files'`)).rows[0];
  await client.query('rollback');

  if (!tracking && existingTables.length) {
    throw new Error(`Found existing ai_workspace tables with no migration history (${existingTables.join(', ')}). Refusing to continue — inspect them manually.`);
  }
  if (bucket?.public) throw new Error('A PUBLIC bucket named "ai-workspace-files" already exists. Refusing to use it for private client files.');
  for (const a of applied) {
    const f = files.find((x) => x.name === a.name);
    if (f && f.checksum !== a.checksum) throw new Error(`Applied migration ${a.name} has been modified since it ran. Create a new migration instead.`);
  }

  const pending = files.filter((f) => !applied.some((a) => a.name === f.name));
  console.log(`\nMigrations: ${files.length} total, ${applied.length} applied, ${pending.length} pending.`);
  for (const f of pending) {
    console.log(`\n▸ ${f.name}`);
    describe(f.sql).forEach((d) => console.log(`    + ${d}`));
  }
  if (!pending.length) console.log('Nothing to do.');

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was changed. Re-run with `--apply` after reviewing the plan above.');
  } else if (pending.length) {
    await client.query(`create table if not exists ${TRACKING} (
      name text primary key, checksum text not null, applied_at timestamptz not null default now(), applied_by text not null default current_user)`);
    await client.query(`alter table ${TRACKING} enable row level security`);
    await client.query(`revoke all on table ${TRACKING} from anon, authenticated`);
    for (const f of pending) {
      process.stdout.write(`Applying ${f.name} … `);
      await client.query('begin');
      try {
        await client.query(f.sql);
        await client.query(`insert into ${TRACKING} (name, checksum) values ($1, $2)`, [f.name, f.checksum]);
        await client.query('commit');
        console.log('done');
      } catch (err) {
        await client.query('rollback');
        console.log('FAILED (rolled back)');
        throw err;
      }
    }
    console.log('\nAll pending migrations applied.');
  }
} catch (err) {
  console.error(`\n✖ ${err.message}`);
  exitCode = 1;
} finally {
  await client.end();
}
process.exit(exitCode);
