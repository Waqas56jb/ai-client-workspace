import { iso } from '../utils/mappers.js';
import { assignments } from './clients.repository.js';

/** Profile fields a member may change on their own row (column-level grants match). */
const PROFILE_COLUMNS = { name: 'display_name', role: 'role_title', avatarColor: 'avatar_colour' };

const SELECT = 'id, display_name, email, role_title, avatar_colour, is_active, last_active_at, created_at';

/** Maps a profile row to the User DTO. Never includes auth data. */
export function mapUser(row) {
  return {
    id: row.id,
    name: row.display_name,
    email: row.email,
    role: row.role_title,
    avatarColor: row.avatar_colour,
    status: row.is_active ? 'active' : 'inactive',
    lastActiveAt: iso(row.last_active_at),
    createdAt: iso(row.created_at),
  };
}

/** Lists team members, optionally filtered by 'active' | 'inactive'. */
export async function listUsers(tx, { status } = {}) {
  const filter = status === 'active' ? 'where is_active' : status === 'inactive' ? 'where not is_active' : '';
  const { rows } = await tx.query(`select ${SELECT} from public.ai_workspace_users ${filter} order by is_active desc, lower(display_name), id`);
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
