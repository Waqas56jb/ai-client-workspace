import { getDatabase } from '../config/db.js';
import { ACTIVITY } from '../constants/domain.js';
import { logActivity } from '../repositories/activity.repository.js';
import * as repo from '../repositories/users.repository.js';
import { forbidden, notFound } from '../utils/errors.js';
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
