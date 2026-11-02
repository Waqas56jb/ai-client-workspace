import { getDatabase } from '../config/db.js';
import { ACTIVITY } from '../constants/domain.js';
import { logActivity } from '../repositories/activity.repository.js';
import * as repo from '../repositories/users.repository.js';
import { getServiceClient } from '../config/supabase.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { clearAuthCache } from '../middleware/authenticate.js';

/** Team members (all, or filtered by status). */
export function listUsers(userId, query = {}) {
  return getDatabase().withUser(userId, (tx) => repo.listUsers(tx, query));
}

/** One team member. */
export function getUser(userId, targetId) {
  return getDatabase().withUser(userId, async (tx) => {
    const user = await repo.findUser(tx, targetId);
    if (!user) throw notFound('Team member');
    return user;
  });
}

/**
 * Updates a profile. Members may update only their own profile (RLS enforces
 * the same rule); email and membership are managed by provisioning.
 */
export function updateProfile(userId, targetId, body) {
  if (targetId !== userId) return Promise.reject(forbidden('You can only update your own profile.'));
  clearAuthCache(userId); // the signed-in profile (name, role) is cached for 30 s
  return getDatabase().withUser(userId, async (tx) => {
    if (!(await repo.updateProfile(tx, userId, body))) throw notFound('Team member');
    const user = await repo.findUser(tx, userId);
    await logActivity(tx, {
      userId,
      type: ACTIVITY.TEAM_UPDATED,
      resourceType: 'user',
      resourceId: userId,
      description: `Updated team profile for ${user.name}`,
      metadata: { fields: Object.keys(body) },
    });
    return user;
  });
}

/*
 * Administrator account management (Team page). Supabase Auth admin calls use the
 * service-role client on the server only; membership rows change on the privileged
 * connection after the caller is checked to be an active administrator.
 * Only accounts this workspace created (is_managed) can have their password set or
 * be blocked — an account shared with another project on the same Supabase
 * instance is never changed.
 */

/** Long enough to mean "until unblocked" (Supabase takes a duration). */
const BLOCKED = '876000h';

function requireAdmin(actor) {
  if (!actor?.isAdmin) throw forbidden('Only a workspace administrator can manage accounts.');
}

function authError(error, fallback) {
  const msg = error?.message || fallback;
  if (/password/i.test(msg)) return badRequest(msg);
  return new AppError('AUTH_ERROR', msg, error?.status >= 400 && error?.status < 500 ? 400 : 502);
}

async function logTeam(actorId, targetId, description, metadata = {}) {
  await getDatabase().withUser(actorId, (tx) =>
    logActivity(tx, { userId: actorId, type: ACTIVITY.TEAM_UPDATED, resourceType: 'user', resourceId: targetId, description, metadata }),
  );
}

/** Creates a member account (or restores a removed one with the same email). */
export async function createMember(actor, { name, email, role, password, isAdmin }) {
  requireAdmin(actor);
  const db = getDatabase();
  const existing = await db.withSystem((tx) => repo.findMemberForAdmin(tx, { email }));
  if (existing && !existing.removed_at) throw conflict('Someone in the workspace already uses this email.');
  if (existing && !existing.is_managed) throw conflict('This email belongs to an account that is managed elsewhere. Use a different email.');

  const admin = getServiceClient().auth.admin;
  let id = existing?.id;
  if (id) {
    const { error } = await admin.updateUserById(id, { password, ban_duration: 'none', user_metadata: { display_name: name } });
    if (error) throw authError(error, 'The account could not be restored.');
  } else {
    const { data, error } = await admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name }, app_metadata: { ai_workspace: true } });
    if (error) {
      if (error.status === 422 || /already|registered|exists/i.test(error.message || '')) throw conflict('An account with this email already exists. Use a different email.');
      throw authError(error, 'The account could not be created.');
    }
    id = data.user.id;
  }
  try {
    await db.withSystem((tx) => repo.upsertManagedMember(tx, { id, name, email, role, isAdmin }));
  } catch (err) {
    if (!existing) await admin.deleteUser(id).catch(() => {});
    throw err;
  }
  clearAuthCache(id);
  await logTeam(actor.id, id, `Added ${name} to the workspace`, { email, isAdmin });
  return getUser(actor.id, id);
}

/** Sets a member's password (accounts this workspace created only). */
export async function setMemberPassword(actor, targetId, password) {
  requireAdmin(actor);
  const target = await getDatabase().withSystem((tx) => repo.findMemberForAdmin(tx, { id: targetId }));
  if (!target || target.removed_at) throw notFound('Team member');
  if (!target.is_managed) {
    throw forbidden('This sign-in is shared with another app, so only its owner can change the password (Settings → Security).');
  }
  const { error } = await getServiceClient().auth.admin.updateUserById(targetId, { password });
  if (error) throw authError(error, 'The password could not be changed.');
  await logTeam(actor.id, targetId, `Changed the password for ${target.display_name}`);
  return { ok: true };
}

/** Removes a member: blocks sign-in, hides them from the team; their past work keeps its author. */
export async function removeMember(actor, targetId) {
  requireAdmin(actor);
  if (targetId === actor.id) throw badRequest('You can’t delete your own account.');
  const db = getDatabase();
  const target = await db.withSystem((tx) => repo.findMemberForAdmin(tx, { id: targetId }));
  if (!target || target.removed_at) throw notFound('Team member');
  if (target.is_managed) {
    const { error } = await getServiceClient().auth.admin.updateUserById(targetId, { ban_duration: BLOCKED });
    if (error) throw authError(error, 'The account could not be blocked.');
  }
  await db.withSystem((tx) => repo.markRemoved(tx, targetId));
  clearAuthCache(targetId); // signed-in sessions lose access on their next request
  await logTeam(actor.id, targetId, `Removed ${target.display_name} from the workspace`, { email: target.email });
  return { ok: true };
}
