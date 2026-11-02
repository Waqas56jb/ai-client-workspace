import { iso } from '../utils/mappers.js';
import { assignments } from './clients.repository.js';

/** Profile fields a member may change on their own row (column-level grants match). */
const PROFILE_COLUMNS = { name: 'display_name', role: 'role_title', avatarColor: 'avatar_colour' };

const SELECT = 'id, display_name, email, role_title, avatar_colour, is_active, is_admin, last_active_at, created_at';

/** Maps a profile row to the User DTO. Never includes auth data. */
export function mapUser(row) {
  return {
    id: row.id,
    name: row.display_name,
    email: row.email,
    role: row.role_title,
    avatarColor: row.avatar_colour,
    status: row.is_active ? 'active' : 'inactive',
    isAdmin: !!row.is_admin,
    lastActiveAt: iso(row.last_active_at),
    createdAt: iso(row.created_at),
  };
}

/** Lists team members, optionally filtered by 'active' | 'inactive'. */
export async function listUsers(tx, { status } = {}) {
  // Removed members are hidden; their past work still shows their name.
  const filter = status === 'active' ? 'and is_active' : status === 'inactive' ? 'and not is_active' : '';
  const { rows } = await tx.query(`select ${SELECT} from public.ai_workspace_users where removed_at is null ${filter} order by is_active desc, lower(display_name), id`);
  return rows.map(mapUser);
}

/** Finds one team member or null. */
export async function findUser(tx, userId) {
  const { rows } = await tx.query(`select ${SELECT} from public.ai_workspace_users where id = $1`, [userId]);
  return rows[0] ? mapUser(rows[0]) : null;
}

/** Updates the caller's own profile fields (RLS also restricts this to `id = auth.uid()`). */
export async function updateProfile(tx, userId, values) {
  const params = [userId];
  const sets = assignments(PROFILE_COLUMNS, values, params);
  const { rowCount } = await tx.query(`update public.ai_workspace_users set ${sets.join(', ')} where id = $1`, params);
  return rowCount > 0;
}

/** Membership details an administrator needs (privileged connection). */
export async function findMemberForAdmin(tx, { id, email }) {
  const { rows } = await tx.query(
    `select id, display_name, email, is_active, is_admin, is_managed, removed_at from public.ai_workspace_users
      where ${id ? 'id = $1' : 'lower(email) = lower($1)'}`,
    [id || email],
  );
  return rows[0] || null;
}

/** Number of active, not-removed administrators. */
export async function countAdmins(tx) {
  const { rows } = await tx.query('select count(*)::int as n from public.ai_workspace_users where is_admin and is_active and removed_at is null');
  return rows[0].n;
}

/** Adds (or restores) a member whose Auth account this workspace created. */
export async function upsertManagedMember(tx, { id, name, email, role, isAdmin }) {
  await tx.query(
    `insert into public.ai_workspace_users (id, display_name, email, role_title, is_active, is_admin, is_managed, removed_at)
     values ($1, $2, $3, $4, true, $5, true, null)
     on conflict (id) do update set display_name = excluded.display_name, role_title = excluded.role_title,
       is_active = true, is_admin = excluded.is_admin, is_managed = true, removed_at = null`,
    [id, name, email, role, isAdmin],
  );
}

/** Removes a member: inactive and hidden; the row stays so history keeps its author. */
export async function markRemoved(tx, id) {
  await tx.query('update public.ai_workspace_users set is_active = false, is_admin = false, removed_at = now() where id = $1', [id]);
}
