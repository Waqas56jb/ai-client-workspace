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
};
