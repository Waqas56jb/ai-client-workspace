import { apiClient, call, notFound } from './apiClient';
import { getDb, mutate } from './mock/db';
import { currentUserId, pickUser } from './mock/relations';
import { createId, nowIso, sortBy, truncate } from '@/lib/utils';

function enrich(db, c) {
  const msgs = db.messages.filter((m) => m.conversationId === c.id);
  const last = msgs[msgs.length - 1];
  return {
    ...c,
    messageCount: msgs.length,
    outputCount: db.outputs.filter((o) => o.conversationId === c.id).length,
    lastMessage: last ? { role: last.role, content: truncate(last.content, 90), createdAt: last.createdAt } : null,
    createdByUser: pickUser(db, c.createdBy),
  };
}

export const conversationService = {
  listByTask: (taskId) =>
    call({
      mock: () => {
        const db = getDb();
        return sortBy(
          db.conversations.filter((c) => c.taskId === taskId).map((c) => enrich(db, c)),
          'updatedAt',
          'desc',
        );
      },
      api: () => apiClient.get(`/tasks/${taskId}/conversations`),
    }),

  /** Conversation with its messages (each message decorated with its author). */
  get: (id) =>
    call({
      mock: () => {
        const db = getDb();
        const c = db.conversations.find((x) => x.id === id);
        if (!c) throw notFound('Conversation');
        const messages = db.messages.filter((m) => m.conversationId === id).map((m) => ({ ...m, user: pickUser(db, m.userId) }));
        return { ...enrich(db, c), messages };
      },
      api: () => apiClient.get(`/conversations/${id}`),
    }),

  create: ({ taskId, tool, title }) =>
    call({
      mock: () =>
        mutate((db) => {
          if (!db.tasks.some((t) => t.id === taskId)) throw notFound('Task');
          const now = nowIso();
          const conv = { id: createId('cv'), taskId, tool: tool || null, title: title?.trim() || 'New conversation', createdAt: now, updatedAt: now, createdBy: currentUserId() };
          db.conversations.push(conv);
          return enrich(db, conv);
        }),
      api: () => apiClient.post(`/tasks/${taskId}/conversations`, { tool, title }),
    }),

  update: (id, patch) =>
    call({
      mock: () =>
        mutate((db) => {
          const c = db.conversations.find((x) => x.id === id);
          if (!c) throw notFound('Conversation');
          Object.assign(c, patch, { updatedAt: nowIso() });
          return enrich(db, c);
        }),
      api: () => apiClient.patch(`/conversations/${id}`, patch),
    }),

  /**
   * Workspace-wide chat history, newest activity first.
   * @param {{ search?, clientId?, tool?, from?: string, to?: string, page?, limit? }} params  from/to: ISO instants
   * @returns {Promise<{ items: object[], meta: object }>}
   */
  history: (params = {}) =>
    call({
      mock: () => {
        const db = getDb();
        let list = db.conversations.map((c) => enrich(db, c));
        if (params.clientId) list = list.filter((c) => c.clientId === params.clientId);
        if (params.tool) list = list.filter((c) => c.tool === params.tool);
        if (params.search) list = list.filter((c) => `${c.title} ${c.lastMessage?.content || ''}`.toLowerCase().includes(params.search.toLowerCase()));
        if (params.from) list = list.filter((c) => c.updatedAt >= params.from);
        if (params.to) list = list.filter((c) => c.updatedAt < params.to);
        const items = sortBy(list, 'updatedAt', 'desc').map((c) => {
          const task = db.tasks.find((t) => t.id === c.taskId);
          const client = db.clients.find((x) => x.id === c.clientId);
          const job = db.jobs.find((j) => j.id === c.jobId);
          return { ...c, lastActivityAt: c.updatedAt, client: client && { id: client.id, name: client.name, primaryColor: client.brand?.primaryColor }, job: job && { id: job.id, title: job.title }, task: task && { id: task.id, title: task.title } };
        });
        return { items, meta: { page: 1, limit: items.length, total: items.length, pages: 1 } };
      },
      api: async () => {
        const res = await apiClient.get('/conversations', { params });
        return { data: { items: res.data || [], meta: res.meta } };
      },
    }),

  /** Where a client's quick AI Assistant chats live: { clientId, jobId, taskId } (created once on the server). */
  assistantSession: (clientId) =>
    call({
      mock: () => {
        const task = getDb().tasks.find((t) => t.clientId === clientId && !t.archivedAt);
        if (!task) throw notFound('Task for this client');
        return { clientId, jobId: task.jobId, taskId: task.id };
      },
      api: () => apiClient.post('/assistant/session', { clientId }),
    }),
};
