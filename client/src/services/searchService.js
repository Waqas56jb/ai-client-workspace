import { apiClient, call } from './apiClient';
import { getDb } from './mock/db';
import { versionText } from './versionService';
import { excerpt, inDateRange } from '@/lib/utils';

/**
 * Frontend search over the current mock workspace. Full-text search across
 * persisted conversations and files will be implemented server-side (Postgres
 * full-text search in Supabase) during the backend phase.
 *
 * Result: { type, id, title, breadcrumb, excerpt, href, date, status?, kind? }
 */
export const SEARCH_GROUPS = [
  { id: 'clients', label: 'Clients' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'files', label: 'Files' },
  { id: 'approved', label: 'Approved outputs' },
];

function hit(text, q) {
  return !!text && text.toLowerCase().includes(q);
}

/**
 * @param {string} query
 * @param {{ clientId?, jobId?, taskId?, dateRange?, fileKind?, approval?, limit? }} filters
 */
function runSearch(query, filters = {}) {
  const db = getDb();
  const q = (query || '').trim().toLowerCase();
  const limit = filters.limit || 50;
  const clientName = (id) => db.clients.find((c) => c.id === id)?.name || 'Unknown client';
  const jobTitle = (id) => db.jobs.find((j) => j.id === id)?.title || 'Unknown job';
  const taskTitle = (id) => db.tasks.find((t) => t.id === id)?.title || 'Unknown task';
  const scoped = (r) =>
    (!filters.clientId || filters.clientId === 'all' || r.clientId === filters.clientId) &&
    (!filters.jobId || filters.jobId === 'all' || r.jobId === filters.jobId) &&
    (!filters.taskId || filters.taskId === 'all' || r.taskId === filters.taskId) &&
    inDateRange(r.date, filters.dateRange);

  const results = { clients: [], jobs: [], tasks: [], conversations: [], files: [], approved: [] };
  if (!q) return results;

  db.clients.forEach((c) => {
    const text = `${c.name} ${c.industry} ${c.description} ${c.contactName} ${c.slug}`;
    if (hit(text, q)) {
      results.clients.push({ type: 'client', id: c.id, clientId: c.id, title: c.name, breadcrumb: c.industry, excerpt: excerpt(c.description, q), href: `/clients/${c.id}`, date: c.updatedAt, status: c.status });
    }
  });

  db.jobs.forEach((j) => {
    if (hit(`${j.title} ${j.description} ${j.notes}`, q)) {
      results.jobs.push({ type: 'job', id: j.id, clientId: j.clientId, jobId: j.id, title: j.title, breadcrumb: clientName(j.clientId), excerpt: excerpt(j.description, q), href: `/jobs/${j.id}`, date: j.updatedAt, status: j.status });
    }
  });

  db.tasks.forEach((t) => {
    if (hit(`${t.title} ${t.description} ${t.notes}`, q)) {
      results.tasks.push({ type: 'task', id: t.id, clientId: t.clientId, jobId: t.jobId, taskId: t.id, title: t.title, breadcrumb: `${clientName(t.clientId)} / ${jobTitle(t.jobId)}`, excerpt: excerpt(t.description, q), href: `/tasks/${t.id}`, date: t.updatedAt, kind: t.type });
    }
  });

  // Conversations: match titles and message content (one result per conversation)
  db.conversations.forEach((c) => {
    const task = db.tasks.find((t) => t.id === c.taskId);
    if (!task) return;
    const msg = db.messages.find((m) => m.conversationId === c.id && hit(m.content, q));
    if (hit(c.title, q) || msg) {
      results.conversations.push({
        type: 'conversation',
        id: c.id,
        clientId: task.clientId,
        jobId: task.jobId,
        taskId: task.id,
        title: c.title,
        breadcrumb: `${clientName(task.clientId)} / ${jobTitle(task.jobId)} / ${task.title}`,
        excerpt: msg ? excerpt(msg.content, q) : '',
        href: `/ai-workspace/${task.id}?conversation=${c.id}`,
        date: c.updatedAt,
      });
    }
  });

  // Files: names, descriptions and generated text content
  db.files.forEach((f) => {
    const output = f.outputId ? db.outputs.find((o) => o.id === f.outputId) : null;
    const current = output ? db.versions.find((v) => v.id === output.currentVersionId) : null;
    const body = versionText(current);
    const status = output ? (output.approvedVersionId ? 'approved' : 'draft') : 'reference';
    if (filters.fileKind && filters.fileKind !== 'all' && f.kind !== filters.fileKind) return;
    if (filters.approval && filters.approval !== 'all' && status !== filters.approval) return;
    if (hit(`${f.name} ${f.description}`, q) || hit(body, q)) {
      results.files.push({
        type: 'file',
        id: f.id,
        clientId: f.clientId,
        jobId: f.jobId,
        taskId: f.taskId,
        title: f.name,
        breadcrumb: [clientName(f.clientId), f.jobId && jobTitle(f.jobId), f.taskId && taskTitle(f.taskId)].filter(Boolean).join(' / '),
        excerpt: hit(body, q) ? excerpt(body, q) : excerpt(f.description, q),
        href: `/files/${f.id}`,
        date: f.updatedAt,
        status,
        kind: f.kind,
      });
    }
  });

  // Approved outputs: search the approved version's content
  db.outputs
    .filter((o) => o.approvedVersionId)
    .forEach((o) => {
      const v = db.versions.find((x) => x.id === o.approvedVersionId);
      const body = versionText(v);
      if (filters.fileKind && filters.fileKind !== 'all' && (o.kind === 'image' ? 'image' : 'text') !== filters.fileKind) return;
      if (filters.approval && filters.approval !== 'all' && filters.approval !== 'approved') return;
      if (hit(o.title, q) || hit(body, q)) {
        results.approved.push({
          type: 'approved',
          id: o.id,
          clientId: o.clientId,
          jobId: o.jobId,
          taskId: o.taskId,
          title: `${o.title} · v${v.versionNumber}`,
          breadcrumb: `${clientName(o.clientId)} / ${jobTitle(o.jobId)} / ${taskTitle(o.taskId)}`,
          excerpt: excerpt(body, q),
          href: o.fileId ? `/files/${o.fileId}` : `/approved`,
          date: v.approvedAt,
          status: 'approved',
          kind: o.kind,
        });
      }
    });

  Object.keys(results).forEach((k) => {
    results[k] = results[k].filter(scoped).slice(0, limit);
  });
  // File-type and approval filters only make sense for file-like groups
  if ((filters.fileKind && filters.fileKind !== 'all') || (filters.approval && filters.approval !== 'all')) {
    results.clients = [];
    results.jobs = [];
    results.tasks = [];
    results.conversations = [];
  }
  return results;
}

export const searchService = {
  search: (query, filters) =>
    call({
      latency: 120,
      mock: () => runSearch(query, filters),
      api: () => apiClient.get('/search', { params: { q: query, ...filters } }),
    }),
};
