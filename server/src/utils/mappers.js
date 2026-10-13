import { DB_TO_TOOL } from '../constants/domain.js';

/**
 * Row → API DTO helpers shared by every module.
 *
 * DTOs deliberately match the shapes the React frontend already consumes
 * (see client/src/services/* mock branches), in camelCase with ISO timestamps.
 */
export const iso = (v) => (v ? new Date(v).toISOString() : null);

export const toolId = (dbValue) => (dbValue ? DB_TO_TOOL[dbValue] || null : null);

/** Compact user summary used inside other DTOs (createdByUser, approvedByUser …). */
export function userSummary(row, prefix = '') {
  const id = row?.[`${prefix}id`];
  if (!id) return null;
  return {
    id,
    name: row[`${prefix}display_name`],
    email: row[`${prefix}email`],
    role: row[`${prefix}role_title`],
    avatarColor: row[`${prefix}avatar_colour`],
  };
}

/** SQL select list for a user summary joined as alias `a`, exposed with `prefix`. */
export const userColumns = (alias, prefix) =>
  ['id', 'display_name', 'email', 'role_title', 'avatar_colour'].map((c) => `${alias}.${c} as ${prefix}${c}`).join(', ');

export function clientSummary(row, prefix = 'client_') {
  const id = row?.[`${prefix}id`];
  if (!id) return null;
  return {
    id,
    name: row[`${prefix}name`],
    slug: row[`${prefix}slug`],
    status: row[`${prefix}status`],
    industry: row[`${prefix}industry`],
    primaryColor: row[`${prefix}primary_colour`],
    logoFileId: row[`${prefix}logo_file_id`] || null,
  };
}
export const clientColumns = (alias, prefix = 'client_') =>
  ['id', 'name', 'slug', 'status', 'industry', 'primary_colour', 'logo_file_id'].map((c) => `${alias}.${c} as ${prefix}${c}`).join(', ');

export function jobSummary(row, prefix = 'job_') {
  const id = row?.[`${prefix}id`];
  if (!id) return null;
  return { id, title: row[`${prefix}title`], status: row[`${prefix}status`], clientId: row[`${prefix}client_id`] };
}
export const jobColumns = (alias, prefix = 'job_') => ['id', 'title', 'status', 'client_id'].map((c) => `${alias}.${c} as ${prefix}${c}`).join(', ');

export function taskSummary(row, prefix = 'task_') {
  const id = row?.[`${prefix}id`];
  if (!id) return null;
  return {
    id,
    title: row[`${prefix}title`],
    type: toolId(row[`${prefix}task_type`]),
    status: row[`${prefix}status`],
    jobId: row[`${prefix}job_id`],
    clientId: row[`${prefix}client_id`],
  };
}
export const taskColumns = (alias, prefix = 'task_') =>
  ['id', 'title', 'task_type', 'status', 'job_id', 'client_id'].map((c) => `${alias}.${c} as ${prefix}${c}`).join(', ');

/** Parses pagination params with sane bounds. */
export function pagination(q = {}, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, Number(q.limit) || defaultLimit));
  const page = Math.max(1, Number(q.page) || 1);
  return { limit, offset: (page - 1) * limit, page };
}

export const pageMeta = ({ page, limit }, total) => ({ page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });

/** Date-range filter ('24h' | '7d' | '30d' | '90d') → interval string or null. */
export function rangeInterval(range) {
  return { '24h': '1 day', '7d': '7 days', '30d': '30 days', '90d': '90 days' }[range] || null;
}
