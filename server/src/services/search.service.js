import { getDatabase } from '../config/db.js';
import { iso, rangeInterval, toolId } from '../utils/mappers.js';
import * as repo from '../repositories/search.repository.js';

/**
 * Workspace search. Returns the grouped shape the frontend renders:
 * { clients, jobs, tasks, conversations, files, approved }.
 */

export const GROUPS = ['clients', 'jobs', 'tasks', 'conversations', 'files', 'approved'];
const SUGGESTION_LIMIT = 8;

const empty = () => Object.fromEntries(GROUPS.map((g) => [g, []]));

/** Removes HTML tags / markdown markers and collapses whitespace. */
export function stripMarkup(text = '') {
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_#>`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Plain-text excerpt (~120 chars) centred on the first occurrence of the query
 * or, failing that, of any query token.
 * @param {string} text
 * @param {string} q
 */
export function excerpt(text, q, radius = 60) {
  const clean = stripMarkup(text);
  if (!clean) return '';
  const lower = clean.toLowerCase();
  let idx = lower.indexOf(q.toLowerCase());
  let len = q.length;
  if (idx < 0) {
    for (const tok of q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
      idx = lower.indexOf(tok);
      len = tok.length;
      if (idx >= 0) break;
    }
  }
  if (idx < 0) return clean.length > radius * 2 ? `${clean.slice(0, radius * 2).trimEnd()}…` : clean;
  const start = Math.max(0, idx - radius);
  const end = Math.min(clean.length, idx + len + radius);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

/** Text of a version like the frontend's versionText(). */
function versionText(row) {
  const sections = Array.isArray(row.version_sections) ? row.version_sections : null;
  if (sections?.length) return sections.map((s) => `${s?.label ?? ''}\n${s?.text ?? ''}`).join('\n\n');
  return row.version_content || row.version_prompt || '';
}

const crumbs = (...parts) => parts.filter(Boolean).join(' / ');
const real = (v) => (v && v !== 'all' ? v : undefined);

const MAPPERS = {
  clients: (r, q) => ({ type: 'client', id: r.id, clientId: r.id, jobId: null, taskId: null, title: r.name, breadcrumb: r.industry || '', excerpt: excerpt(r.description, q), href: `/clients/${r.id}`, date: iso(r.updated_at), status: r.status }),
  jobs: (r, q) => ({ type: 'job', id: r.id, clientId: r.client_id, jobId: r.id, taskId: null, title: r.title, breadcrumb: r.client_name, excerpt: excerpt(r.description, q), href: `/jobs/${r.id}`, date: iso(r.updated_at), status: r.status }),
  tasks: (r, q) => ({ type: 'task', id: r.id, clientId: r.client_id, jobId: r.job_id, taskId: r.id, title: r.title, breadcrumb: crumbs(r.client_name, r.job_title), excerpt: excerpt(r.description, q), href: `/tasks/${r.id}`, date: iso(r.updated_at), kind: toolId(r.task_type) }),
  conversations: (r, q) => ({
    type: 'conversation',
    id: r.id,
    clientId: r.client_id,
    jobId: r.job_id,
    taskId: r.task_id,
    title: r.title,
    breadcrumb: crumbs(r.client_name, r.job_title, r.task_title),
    excerpt: r.message_content ? excerpt(r.message_content, q) : '',
    href: `/ai-workspace/${r.task_id}?conversation=${r.id}`,
    date: iso(r.updated_at),
  }),
  files: (r, q) => ({
    type: 'file',
    id: r.id,
    clientId: r.client_id,
    jobId: r.job_id,
    taskId: r.task_id,
    title: r.file_name,
    breadcrumb: crumbs(r.client_name, r.job_title, r.task_title),
    excerpt: r.content_hit ? excerpt(versionText(r), q) : excerpt(r.description, q),
    href: `/files/${r.id}`,
    date: iso(r.updated_at),
    status: r.status,
    kind: r.file_category,
  }),
  approved: (r, q) => ({
    type: 'approved',
    id: r.id,
    clientId: r.client_id,
    jobId: r.job_id,
    taskId: r.task_id,
    title: `${r.title} · v${r.version_number}`,
    breadcrumb: crumbs(r.client_name, r.job_title, r.task_title),
    excerpt: excerpt(versionText(r), q),
    href: r.file_id ? `/files/${r.file_id}` : '/approved',
    date: iso(r.approved_at),
    status: 'approved',
    kind: r.output_kind,
  }),
};

const QUERIES = {
  clients: repo.searchClients,
  jobs: repo.searchJobs,
  tasks: repo.searchTasks,
  conversations: repo.searchConversations,
  files: repo.searchFiles,
  approved: repo.searchApproved,
};

/**
 * Which groups can contain results for these filters (mirrors the frontend's
 * scoping: a job filter excludes clients, a task filter excludes clients/jobs,
 * file-kind/approval filters keep only file-like groups).
 */
function activeGroups(f, type) {
  let groups = [...GROUPS];
  if (f.jobId || f.taskId) groups = groups.filter((g) => g !== 'clients');
  if (f.taskId) groups = groups.filter((g) => g !== 'jobs');
  if (f.fileKind || f.approval) groups = groups.filter((g) => g === 'files' || g === 'approved');
  if (f.approval && f.approval !== 'approved') groups = groups.filter((g) => g !== 'approved');
  if (type) groups = groups.filter((g) => g === type);
  return groups;
}

async function runGroups(tx, q, groups, f, limit) {
  const m = repo.matchParams(q);
  const out = empty();
  for (const g of groups) {
    const rows = await QUERIES[g](tx, m, f, limit);
    out[g] = rows.map((r) => MAPPERS[g](r, q));
  }
  return out;
}

/**
 * Grouped search.
 * @param {string} userId
 * @param {{ q?: string, clientId?, jobId?, taskId?, dateRange?, fileKind?, approval?, limit?: number, type?: string }} params validated query
 */
export async function search(userId, params) {
  const q = (params.q || '').trim();
  if (!q) return empty();
  const f = {
    clientId: real(params.clientId),
    jobId: real(params.jobId),
    taskId: real(params.taskId),
    interval: rangeInterval(params.dateRange) || undefined,
    fileKind: real(params.fileKind),
    approval: real(params.approval),
  };
  const groups = activeGroups(f, real(params.type));
  if (!groups.length) return empty();
  return getDatabase().withUser(userId, (tx) => runGroups(tx, q, groups, f, params.limit));
}

/**
 * Top 8 mixed suggestions (titles starting with the query first, then most recent).
 * @param {string} userId
 * @param {string} q
 * @returns {Promise<Array<{ type, id, title, breadcrumb, href, date }>>}
 */
export async function suggestions(userId, q) {
  const query = (q || '').trim();
  if (!query) return [];
  const grouped = await getDatabase().withUser(userId, (tx) => runGroups(tx, query, ['clients', 'jobs', 'tasks', 'conversations', 'files'], {}, SUGGESTION_LIMIT));
  const lower = query.toLowerCase();
  const score = (r) => (r.title.toLowerCase().startsWith(lower) ? 0 : r.title.toLowerCase().includes(lower) ? 1 : 2);
  return Object.values(grouped)
    .flat()
    .sort((a, b) => score(a) - score(b) || String(b.date).localeCompare(String(a.date)))
    .slice(0, SUGGESTION_LIMIT)
    .map(({ type, id, title, breadcrumb, href, date }) => ({ type, id, title, breadcrumb, href, date }));
}
