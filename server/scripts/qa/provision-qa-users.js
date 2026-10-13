#!/usr/bin/env node
/**
 * QA ONLY — provisions dedicated test accounts for the live test suite and
 * writes their credentials to server/.env.qa (git-ignored). Never prints passwords.
 *
 *   node scripts/qa/provision-qa-users.js            create (idempotent: reuses .env.qa if present)
 *   node scripts/qa/provision-qa-users.js --remove   delete the QA auth users and their profiles
 *
 * Accounts (all emails end in @qa.studioflow.invalid-style example.com addresses tagged "qa-sf-"):
 *   QA_MEMBER_A/B/C  active workspace members
 *   QA_INACTIVE      workspace profile with is_active = false
 *   QA_OUTSIDER      Supabase Auth user with NO workspace profile (another project's user)
 *
 * Removal is only possible for users whose email starts with "qa-sf-" AND that are
 * listed in .env.qa, so real accounts can never be touched.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createScriptClient } from '../lib/pg.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_QA = path.resolve(here, '../../.env.qa');
const PREFIX = 'qa-sf-';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function readEnvQa() {
  if (!fs.existsSync(ENV_QA)) return {};
  return Object.fromEntries(
    fs.readFileSync(ENV_QA, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

const ACCOUNTS = [
  { key: 'QA_MEMBER_A', name: 'QA Member A', role: 'Creative Director', profile: 'active' },
  { key: 'QA_MEMBER_B', name: 'QA Member B', role: 'Senior Copywriter', profile: 'active' },
  { key: 'QA_MEMBER_C', name: 'QA Member C', role: 'Designer', profile: 'active' },
  { key: 'QA_INACTIVE', name: 'QA Inactive', role: 'Former member', profile: 'inactive' },
  { key: 'QA_OUTSIDER', name: 'QA Outsider', role: '', profile: 'none' },
];

const db = createScriptClient();
await db.connect();
try {
  const existing = readEnvQa();
  if (process.argv.includes('--remove')) {
    for (const a of ACCOUNTS) {
      const id = existing[`${a.key}_ID`];
      const email = existing[`${a.key}_EMAIL`];
      if (!id || !email?.startsWith(PREFIX)) continue;
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user?.email !== email) {
        console.log(`skip ${a.key}: auth user does not match .env.qa`);
        continue;
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      console.log(`${a.key}: ${error ? `delete failed (${error.message})` : 'deleted'}`);
    }
  } else {
    const runId = existing.QA_ACCOUNT_RUN || crypto.randomBytes(3).toString('hex');
    const out = { QA_ACCOUNT_RUN: runId, QA_API_URL: existing.QA_API_URL || 'http://localhost:5055/api/v1' };
    for (const a of ACCOUNTS) {
      let id = existing[`${a.key}_ID`];
      const email = existing[`${a.key}_EMAIL`] || `${PREFIX}${runId}-${a.key.toLowerCase().replace('qa_', '').replace('_', '-')}@example.com`;
      const password = existing[`${a.key}_PASSWORD`] || crypto.randomBytes(18).toString('base64url');
      if (!id) {
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { qa: true } });
        if (error) throw new Error(`createUser ${a.key}: ${error.message}`);
        id = data.user.id;
      }
      if (a.profile !== 'none') {
        await db.query(
          `insert into public.ai_workspace_users (id, display_name, email, role_title, is_active)
           values ($1, $2, $3, $4, $5)
           on conflict (id) do update set is_active = excluded.is_active`,
          [id, a.name, email, a.role, a.profile === 'active'],
        );
      }
      Object.assign(out, { [`${a.key}_ID`]: id, [`${a.key}_EMAIL`]: email, [`${a.key}_PASSWORD`]: password });
      console.log(`${a.key}: ready (${a.profile})`);
    }
    fs.writeFileSync(ENV_QA, `# QA-only test accounts. Git-ignored. Do not commit.\n${Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
    console.log(`Credentials written to ${path.relative(process.cwd(), ENV_QA)}`);
  }
} finally {
  await db.end();
}
