#!/usr/bin/env node
/**
 * Administrator-only provisioning of workspace members (there is no public sign-up).
 *
 *   npm run users:provision -- --email jo@agency.com --name "Jo Smith" --role "Copywriter"
 *   npm run users:provision -- --email jo@agency.com --deactivate
 *   npm run users:provision -- --email jo@agency.com --activate
 *
 * New accounts: the password is read from the PROVISION_PASSWORD environment
 * variable if set (never pass passwords as CLI arguments — they end up in shell
 * history); otherwise a strong random temporary password is generated and
 * printed ONCE. Ask the user to change it after first sign-in.
 *
 * If a Supabase Auth user with that email already exists (it may belong to
 * another project on this Supabase instance), the script refuses unless
 * --link-existing is given explicitly.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createScriptClient } from './lib/pg.js';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

const email = arg('email')?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: --email <address> [--name "Full Name"] [--role "Role"] [--deactivate|--activate] [--link-existing]');
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in server/.env');
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const db = createScriptClient();
await db.connect();

async function findAuthUserByEmail(target) {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list auth users: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

try {
  if (flag('deactivate') || flag('activate')) {
    const active = flag('activate');
    const r = await db.query('update public.ai_workspace_users set is_active = $1 where lower(email) = $2', [active, email]);
    console.log(r.rowCount ? `${email} is now ${active ? 'active' : 'inactive'}.` : `No workspace profile for ${email}.`);
  } else {
    const name = arg('name')?.trim();
    const role = (arg('role') || 'Team member').trim();
    if (!name) throw new Error('--name is required when provisioning a user');

    let authUser = await findAuthUserByEmail(email);
    let tempPassword = null;
    if (authUser && !flag('link-existing')) {
      throw new Error(`A Supabase Auth user with ${email} already exists. It may belong to another project. Re-run with --link-existing only if this person should also be a workspace member.`);
    }
    if (!authUser) {
      const password = process.env.PROVISION_PASSWORD || (tempPassword = crypto.randomBytes(18).toString('base64url'));
      if (password.length < 12) throw new Error('PROVISION_PASSWORD must be at least 12 characters.');
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
      if (error) throw new Error(`Could not create auth user: ${error.message}`);
      authUser = data.user;
    }

    await db.query(
      `insert into public.ai_workspace_users (id, display_name, email, role_title, is_active)
       values ($1, $2, $3, $4, true)
       on conflict (id) do update set display_name = excluded.display_name, role_title = excluded.role_title, is_active = true`,
      [authUser.id, name, email, role],
    );
    console.log(`✔ ${name} <${email}> is an active workspace member (${authUser.id}).`);
    if (tempPassword) {
      console.log(`  Temporary password (shown once — share securely, ask them to change it): ${tempPassword}`);
    }
  }
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
