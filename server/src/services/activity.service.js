import { getDatabase } from '../config/db.js';
import { listActivity as queryActivity } from '../repositories/activityQuery.repository.js';

/** Workspace activity timeline with optional scope filters. */
export function listActivity(userId, query = {}) {
  return getDatabase().withUser(userId, (tx) => queryActivity(tx, query));
}
