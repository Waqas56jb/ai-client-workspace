import { getDb } from './db';
import { createId, nowIso } from '@/lib/utils';
import { config } from '@/lib/config';

/** Id of the signed-in demo user, used for createdBy / audit fields. */
export function currentUserId() {
  try {
    const raw = localStorage.getItem(config.sessionKey) || sessionStorage.getItem(config.sessionKey);
    return raw ? JSON.parse(raw).userId : null;
  } catch {
    return null;
  }
}

export const pickUser = (db, id) => {
  const u = db.users.find((x) => x.id === id);
  return u ? { id: u.id, name: u.name, avatarColor: u.avatarColor, role: u.role, email: u.email } : null;
};

export const pickClient = (db, id) => {
  const c = db.clients.find((x) => x.id === id);
  return c
    ? { id: c.id, name: c.name, slug: c.slug, status: c.status, industry: c.industry, primaryColor: c.brand?.primaryColor, logoFileId: c.brand?.logoFileId || null }
    : null;
};

export const pickJob = (db, id) => {
  const j = db.jobs.find((x) => x.id === id);
  return j ? { id: j.id, title: j.title, status: j.status, clientId: j.clientId } : null;
};

export const pickTask = (db, id) => {
  const t = db.tasks.find((x) => x.id === id);
  return t ? { id: t.id, title: t.title, type: t.type, status: t.status, jobId: t.jobId, clientId: t.clientId } : null;
};

/** Approval state of an output: 'approved' if any approved version is current, else 'draft'. */
export function outputStatus(output) {
  return output?.approvedVersionId ? 'approved' : 'draft';
}

/** True when an approved output has a newer draft revision waiting. */
export function hasPendingRevision(output) {
  return !!output?.approvedVersionId && output.currentVersionId !== output.approvedVersionId;
}

export function countOutputs(db, predicate) {
  const list = db.outputs.filter(predicate);
  return {
    outputs: list.length,
    drafts: list.filter((o) => o.currentVersionId !== o.approvedVersionId).length,
    approved: list.filter((o) => o.approvedVersionId).length,
  };
}

export function logActivity(db, { type, resourceType, resourceId, clientId = null, jobId = null, taskId = null, description, userId }) {
  const entry = {
    id: createId('act'),
    type,
    userId: userId || currentUserId() || 'u_amelia',
    resourceType,
    resourceId,
    clientId,
    jobId,
    taskId,
    description,
    createdAt: nowIso(),
  };
  db.activity.unshift(entry);
  if (db.activity.length > 500) db.activity.length = 500;
  return entry;
}

export function touchTask(db, taskId) {
  const t = db.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const at = nowIso();
  t.updatedAt = at;
  const j = db.jobs.find((x) => x.id === t.jobId);
  if (j) j.updatedAt = at;
  const c = db.clients.find((x) => x.id === t.clientId);
  if (c) c.updatedAt = at;
}

export { getDb };
