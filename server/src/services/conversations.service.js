import { getDatabase } from '../config/db.js';
import { ACTIVITY, TOOL_TO_DB } from '../constants/domain.js';
import { logActivity } from '../repositories/activity.repository.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import * as convRepo from '../repositories/conversations.repository.js';
import * as msgRepo from '../repositories/messages.repository.js';

/** Messages embedded in GET /conversations/:id (most recent N, oldest first). */
const EMBEDDED_MESSAGE_LIMIT = 200;

const db = () => getDatabase();

async function requireTask(tx, taskId) {
  const task = await convRepo.getTaskScope(tx, taskId);
  if (!task) throw notFound('Task');
  return task;
}

async function requireConversation(tx, id) {
  const conv = await msgRepo.getConversationScoped(tx, id);
  if (!conv) throw notFound('Conversation');
  return conv;
}

async function loadDto(tx, id) {
  const row = await convRepo.getConversationRow(tx, id);
  if (!row) throw notFound('Conversation');
  return convRepo.toConversationDto(row);
}

/**
 * Lists a task's conversations, newest first.
 * @param {string} userId
 * @param {string} taskId
 * @param {{ includeArchived?: 'true'|'false'|'only' }} query
 */
export function listForTask(userId, taskId, query = {}) {
  const includeArchived = query.includeArchived === 'only' ? 'only' : query.includeArchived === 'true';
  return db().withUser(userId, async (tx) => {
    await requireTask(tx, taskId);
    const rows = await convRepo.listByTask(tx, taskId, { includeArchived });
    return rows.map(convRepo.toConversationDto);
  });
}

/**
 * Creates a conversation. Client/job scope is copied from the task row — never
 * from the request body. Archived tasks cannot receive new conversations.
 * @param {string} userId
 * @param {string} taskId
 * @param {{ title?: string, tool?: string|null }} body
 */
export function create(userId, taskId, { title, tool }) {
  return db().withUser(userId, async (tx) => {
    const task = await requireTask(tx, taskId);
    if (task.archived_at) throw conflict('This task is archived. Restore it before starting a conversation.');
    const id = await convRepo.insertConversation(tx, {
      task,
      title: title || 'New conversation',
      toolType: tool ? TOOL_TO_DB[tool] : null,
      userId,
    });
    return loadDto(tx, id);
  });
}

/**
 * Conversation DTO with its (most recent) messages, oldest first.
 * @param {string} userId
 * @param {string} id
 */
export function getWithMessages(userId, id) {
  return db().withUser(userId, async (tx) => {
    const dto = await loadDto(tx, id);
    const { rows, hasMore } = await msgRepo.listMessagesPage(tx, id, { limit: EMBEDDED_MESSAGE_LIMIT });
    return { ...dto, messages: rows.map(msgRepo.toMessageDto), hasMoreMessages: hasMore };
  });
}

/**
 * Updates title / tool / archived flag.
 * @param {string} userId
 * @param {string} id
 * @param {{ title?: string, tool?: string|null, archived?: boolean }} body
 */
export function update(userId, id, body) {
  return db().withUser(userId, async (tx) => {
    await requireConversation(tx, id);
    const fields = {};
    if (body.title !== undefined) fields.title = body.title;
    if (body.tool !== undefined) fields.tool_type = body.tool ? TOOL_TO_DB[body.tool] : null;
    if (body.archived !== undefined) fields.archived = body.archived;
    await convRepo.updateConversation(tx, id, fields, userId);
    return loadDto(tx, id);
  });
}

/**
 * Keyset-paginated messages (oldest first within the page).
 * @param {string} userId
 * @param {string} id
 * @param {{ before?: string, limit: number }} query
 * @returns {Promise<{ messages: object[], meta: { limit, hasMore, nextBefore } }>}
 */
export function listMessages(userId, id, { before, limit }) {
  return db().withUser(userId, async (tx) => {
    await requireConversation(tx, id);
    if (before && !(await msgRepo.messageBelongs(tx, id, before))) throw badRequest('The `before` cursor does not belong to this conversation.');
    const { rows, hasMore } = await msgRepo.listMessagesPage(tx, id, { before, limit });
    const messages = rows.map(msgRepo.toMessageDto);
    return { messages, meta: { limit, hasMore, nextBefore: hasMore && messages.length ? messages[0].id : null } };
  });
}

/**
 * Stores a plain user note (no AI generation).
 * @param {string} userId
 * @param {string} id
 * @param {{ content: string, attachmentIds?: string[] }} body
 */
export function addNote(userId, id, { content, attachmentIds = [] }) {
  return db().withUser(userId, async (tx) => {
    const conv = await requireConversation(tx, id);
    if (conv.archived_at) throw conflict('This conversation is archived. Restore it before adding messages.');
    const unique = [...new Set(attachmentIds)];
    if (unique.length && (await convRepo.countClientFiles(tx, unique, conv.client_id)) !== unique.length) {
      throw badRequest('One or more attachments do not exist or belong to a different client.');
    }
    const metadata = { note: true };
    if (unique.length) metadata.attachmentIds = unique;
    const row = await msgRepo.insertMessage(tx, { conversationId: id, role: 'user', content, messageType: 'prompt', metadata, userId });
    return msgRepo.toMessageDto(await msgRepo.getMessageRow(tx, row.id));
  });
}

/**
 * Workspace-wide chat history (newest activity first), filterable by text,
 * client, tool and the date a message was written.
 */
export function listAll(userId, q) {
  return db().withUser(userId, async (tx) => {
    const limit = q.limit;
    const { rows, total } = await convRepo.listAll(tx, {
      search: q.search || undefined,
      clientId: q.clientId,
      toolType: q.tool ? TOOL_TO_DB[q.tool] : undefined,
      from: q.from,
      to: q.to,
      includeArchived: q.includeArchived === 'true',
      limit,
      offset: (q.page - 1) * limit,
    });
    return { items: rows.map(convRepo.toHistoryDto), meta: { page: q.page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
  });
}

/** Name of the per-client job and task that hold quick AI Assistant chats. */
export const ASSISTANT_JOB_TITLE = 'AI Assistant';
export const ASSISTANT_TASK_TITLE = 'AI Assistant chats';

/**
 * Returns (creating once if needed) the job + task where a client's AI Assistant
 * chats live, so a chat can start with just a client — no job or task set-up.
 * All normal rules still apply to these chats (client isolation, versions, approvals).
 */
export function assistantSession(user, clientId) {
  return db().withUser(user.id, async (tx) => {
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`ai_assistant:${clientId}`]);
    const { rows: clients } = await tx.query('select id, name, status from public.ai_workspace_clients where id = $1', [clientId]);
    const client = clients[0];
    if (!client) throw notFound('Client');
    if (client.status === 'archived') throw badRequest('This client is archived. Restore it before starting a chat.');

    let { rows } = await tx.query(
      `select t.id as task_id, t.job_id from public.ai_workspace_tasks t
         join public.ai_workspace_jobs j on j.id = t.job_id
        where t.client_id = $1 and t.title = $2 and j.title = $3 and t.archived_at is null and j.status <> 'archived'
        order by t.created_at limit 1`,
      [clientId, ASSISTANT_TASK_TITLE, ASSISTANT_JOB_TITLE],
    );
    if (!rows[0]) {
      const job = await tx.query(
        `insert into public.ai_workspace_jobs (client_id, title, description, status, created_by, updated_by)
         values ($1, $2, 'Quick requests from the AI Assistant.', 'active', $3, $3) returning id`,
        [clientId, ASSISTANT_JOB_TITLE, user.id],
      );
      const task = await tx.query(
        `insert into public.ai_workspace_tasks (client_id, job_id, title, task_type, status, created_by, updated_by)
         values ($1, $2, $3, 'general', 'in_progress', $4, $4) returning id`,
        [clientId, job.rows[0].id, ASSISTANT_TASK_TITLE, user.id],
      );
      await logActivity(tx, {
        userId: user.id,
        type: ACTIVITY.TASK_CREATED,
        resourceType: 'task',
        resourceId: task.rows[0].id,
        clientId,
        jobId: job.rows[0].id,
        taskId: task.rows[0].id,
        description: `Set up the AI Assistant for “${client.name}”`,
      });
      rows = [{ task_id: task.rows[0].id, job_id: job.rows[0].id }];
    }
    return { clientId, jobId: rows[0].job_id, taskId: rows[0].task_id };
  });
}
