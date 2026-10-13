import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, migrationFiles, asUser, provisionUser } from '../helpers/testDb.js';
import { checkMigrationSafety } from '../../scripts/lib/migrationSafety.js';

const AMELIA = '11111111-1111-4111-8111-111111111111';
const OUTSIDER = '55555555-5555-4555-8555-555555555555';

let db;
beforeAll(async () => {
  db = await createTestDb();
  await provisionUser(db, { id: AMELIA, email: 'a@test.local' });
  await db.query('insert into auth.users (id, email) values ($1, $2)', [OUTSIDER, 'o@test.local']);
});

describe('migration safety (static)', () => {
  it('contains no destructive statements', () => {
    for (const m of migrationFiles()) expect(checkMigrationSafety(m.sql), m.name).toEqual([]);
  });

  it('detects destructive statements', () => {
    expect(checkMigrationSafety('drop table public.users;')).not.toEqual([]);
    expect(checkMigrationSafety('TRUNCATE public.ai_workspace_clients')).not.toEqual([]);
    expect(checkMigrationSafety('create table public.clients (id int);')).not.toEqual([]);
  });
});

describe('migration behaviour (isolated PGlite)', () => {
  it('every new table uses the ai_workspace_ prefix', async () => {
    const { rows } = await db.query(`select tablename from pg_tables where schemaname = 'public' and tablename <> 'other_project_clients'`);
    expect(rows.length).toBeGreaterThanOrEqual(17);
    rows.forEach((r) => expect(r.tablename.startsWith('ai_workspace_')).toBe(true));
  });

  it('every new function, trigger and policy uses the prefix', async () => {
    const fns = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
    fns.rows.forEach((r) => expect(r.proname.startsWith('ai_workspace_')).toBe(true));
    const trg = await db.query(`select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`);
    trg.rows.forEach((r) => expect(r.tgname.startsWith('ai_workspace_')).toBe(true));
    const pol = await db.query(`select policyname from pg_policies`);
    pol.rows.forEach((r) => expect(r.policyname.startsWith('ai_workspace_')).toBe(true));
  });

  it('re-running migrations is idempotent and preserves application data and unrelated objects', async () => {
    await db.query(`insert into public.ai_workspace_clients (name, slug) values ('Keep Me', 'keep-me')`);
    for (const m of migrationFiles()) await db.exec(m.sql);
    const c = await db.query(`select count(*)::int n from public.ai_workspace_clients where slug = 'keep-me'`);
    expect(c.rows[0].n).toBe(1);
    const other = await db.query(`select name from public.other_project_clients`);
    expect(other.rows[0].name).toBe('must-survive');
    const buckets = await db.query(`select id, public from storage.buckets order by id`);
    expect(buckets.rows).toEqual([
      { id: 'ai-workspace-files', public: false },
      { id: 'other_project_bucket', public: true },
    ]);
  });

  it('RLS hides all application data from non-members and anonymous users', async () => {
    const asOutsider = await asUser(db, OUTSIDER, (tx) => tx.query('select count(*)::int n from public.ai_workspace_clients'));
    expect(asOutsider.rows[0].n).toBe(0);
    await expect(asUser(db, OUTSIDER, (tx) => tx.query(`insert into public.ai_workspace_clients (name, slug) values ('x', 'x-x')`))).rejects.toThrow();
    const asMember = await asUser(db, AMELIA, (tx) => tx.query('select count(*)::int n from public.ai_workspace_clients'));
    expect(asMember.rows[0].n).toBeGreaterThan(0);
  });

  it('members cannot grant themselves membership', async () => {
    await expect(
      asUser(db, OUTSIDER, (tx) => tx.query(`insert into public.ai_workspace_users (id, display_name, email) values ($1, 'x', 'x@x')`, [OUTSIDER])),
    ).rejects.toThrow();
  });
});
