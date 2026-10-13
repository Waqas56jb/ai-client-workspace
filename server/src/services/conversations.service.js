import { getDatabase } from '../config/db.js';
import { TOOL_TO_DB } from '../constants/domain.js';
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
