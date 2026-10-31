import { iso, toolId, userColumns, userSummary } from '../utils/mappers.js';
import { TOOL_IDS } from '../constants/domain.js';

/**
 * Messages repository (SQL + row mapping). Also the public helper surface used
 * by the AI module to persist prompts/responses inside its own transaction.
 *
 * Rules enforced here:
 *  - `system` messages are stored for audit only and are NEVER returned in any
 *    history/listing helper (system prompts must not reach the frontend).
 *  - Message timestamps use clock_timestamp() so several messages written in
 *    one transaction keep their insertion order.
 */

const T = 'public.ai_workspace_messages';
const C = 'public.ai_workspace_conversations';
const U = 'public.ai_workspace_users';

const MESSAGE_TYPES = ['prompt', 'response', 'clarification', 'error', 'status'];
const ROLES = ['user', 'assistant', 'system'];

/** message_type → UI status */
const STATUS_BY_TYPE = { response: 'complete', prompt: 'complete', error: 'error', clarification: 'clarify', status: 'pending' };

/** Select list producing the row shape `toMessageDto` expects (aliases: m = message, c = conversation, u = author). */
export const MESSAGE_SELECT = `m.id, m.conversation_id, m.role, m.content, m.message_type, m.metadata, m.created_by, m.created_at,
  c.task_id, c.tool_type, ${userColumns('u', 'u_')}`;
const MESSAGE_FROM = `${T} m join ${C} c on c.id = m.conversation_id left join ${U} u on u.id = m.created_by`;

/**
 * Maps a message row (selected with `MESSAGE_SELECT`) to the Message DTO.
 * Metadata keys outputIds/options/resolved/attachmentIds/requestOptions/
 * generationPrompt/requestMeta/generationId are exposed at the top level.
 * @param {object} row
 * @returns {object} Message DTO
 */
export function toMessageDto(row) {
  const meta = row.metadata || {};
  const isUser = row.role === 'user';
  const metaTool = TOOL_IDS.includes(meta.tool) ? meta.tool : null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    taskId: row.task_id ?? null,
    role: row.role,
    content: row.content,
    createdAt: iso(row.created_at),
    userId: isUser ? row.created_by || null : null,
    user: isUser ? userSummary(row, 'u_') : null,
    tool: metaTool || toolId(row.tool_type),
    status: STATUS_BY_TYPE[row.message_type] || 'complete',
    outputIds: Array.isArray(meta.outputIds) ? meta.outputIds : [],
    // The exact version each output got from this message (same order as outputIds; older messages have none).
    versionIds: Array.isArray(meta.versionIds) ? meta.versionIds : [],
    editedFromId: meta.replacesMessageId ?? null,
    memoryUpdates: meta.memoryUpdates ?? null,
    // what the assistant decided for this message (answer | write | generate_image | edit_image | clarify | unsupported)
    intent: (typeof meta.intent === 'string' ? meta.intent : meta.intent?.action) ?? null,
    options: meta.options ?? null,
    resolved: meta.resolved ?? (row.message_type === 'clarification' ? false : undefined),
    attachmentIds: Array.isArray(meta.attachmentIds) ? meta.attachmentIds : [],
    requestOptions: meta.requestOptions ?? null,
    generationPrompt: meta.generationPrompt ?? null,
    requestMeta: meta.requestMeta ?? null,
    generationId: meta.generationId ?? null,
  };
}

/**
 * Inserts a message and bumps the conversation's updated_at/updated_by.
 * Runs in the caller's transaction (RLS applies).
 * @param {object} tx open transaction from `withUser`
 * @param {{ conversationId: string, role: 'user'|'assistant'|'system', content?: string,
 *   messageType?: 'prompt'|'response'|'clarification'|'error'|'status', metadata?: object, userId: string }} input
 * @returns {Promise<object>} the inserted raw row (`toMessageDto` needs `getMessageRow` for task/tool/user columns)
 */
export async function insertMessage(tx, { conversationId, role, content = '', messageType = 'prompt', metadata = {}, userId }) {
  if (!ROLES.includes(role)) throw new Error(`invalid message role: ${role}`);
  if (!MESSAGE_TYPES.includes(messageType)) throw new Error(`invalid message type: ${messageType}`);
  const { rows } = await tx.query(
    `insert into ${T} (conversation_id, role, content, message_type, metadata, created_by, created_at)
     values ($1, $2, $3, $4, $5, $6, clock_timestamp())
     returning *`,
    [conversationId, role, content ?? '', messageType, metadata || {}, userId || null],
  );
  await tx.query(`update ${C} set updated_by = $2 where id = $1`, [conversationId, userId || null]);
  return rows[0];
}

/**
 * Shallow-merges `patch` into a message's metadata (jsonb `||`), e.g. to mark a
 * clarification resolved or attach outputIds/generationId later.
 * @param {object} tx
 * @param {string} messageId
 * @param {object} patch
 * @returns {Promise<object|null>} updated raw row or null when not found
 */
export async function updateMessageMetadata(tx, messageId, patch) {
  const { rows } = await tx.query(`update ${T} set metadata = metadata || $2::jsonb where id = $1 returning *`, [messageId, JSON.stringify(patch || {})]);
  return rows[0] || null;
}

/**
 * Loads a conversation row with its scope (client_id, job_id, task_id, tool_type,
 * title, archived_at). Returns null when not found / not visible under RLS.
 * @param {object} tx
 * @param {string} conversationId
 * @returns {Promise<object|null>}
 */
export async function getConversationScoped(tx, conversationId) {
  const { rows } = await tx.query(
    `select id, client_id, job_id, task_id, tool_type, title, created_by, created_at, updated_at, archived_at
       from ${C} where id = $1`,
    [conversationId],
  );
  return rows[0] || null;
}

/**
 * Recent conversation history for model context, OLDEST FIRST. Excludes system
 * messages and transient status/error messages.
 * @param {object} tx
 * @param {string} conversationId
 * @param {number} [limit=20]
 * @returns {Promise<Array<{ id, role, content, message_type, metadata, created_at }>>}
 */
export async function listMessagesForContext(tx, conversationId, limit = 20) {
  const { rows } = await tx.query(
    `select * from (
       select id, role, content, message_type, metadata, created_at
         from ${T}
        where conversation_id = $1 and role <> 'system' and message_type not in ('status', 'error')
          and metadata ->> 'supersededAt' is null
        order by created_at desc, id desc
        limit $2
     ) recent order by created_at asc, id asc`,
    [conversationId, Math.max(1, Math.min(200, Number(limit) || 20))],
  );
  return rows;
}

/**
 * Loads one message in DTO-ready row shape (never a system message).
 * @param {object} tx
 * @param {string} messageId
 * @returns {Promise<object|null>}
 */
export async function getMessageRow(tx, messageId) {
  const { rows } = await tx.query(`select ${MESSAGE_SELECT} from ${MESSAGE_FROM} where m.id = $1 and m.role <> 'system'`, [messageId]);
  return rows[0] || null;
}

/**
 * Page of visible messages for a conversation, returned OLDEST FIRST.
 * Cursor: messages strictly older than message `before` (keyset on created_at, id).
 * @param {object} tx
 * @param {string} conversationId
 * @param {{ before?: string, limit?: number }} opts
 * @returns {Promise<{ rows: object[], hasMore: boolean }>}
 */
export async function listMessagesPage(tx, conversationId, { before, limit = 50 } = {}) {
  const params = [conversationId, limit + 1];
  let cursor = '';
  if (before) {
    params.push(before);
    cursor = `and (m.created_at, m.id) < (select b.created_at, b.id from ${T} b where b.id = $3 and b.conversation_id = $1)`;
  }
  const { rows } = await tx.query(
    `select ${MESSAGE_SELECT} from ${MESSAGE_FROM}
      where m.conversation_id = $1 and m.role <> 'system' and m.metadata ->> 'supersededAt' is null ${cursor}
      order by m.created_at desc, m.id desc
      limit $2`,
    params,
  );
  const hasMore = rows.length > limit;
  return { rows: rows.slice(0, limit).reverse(), hasMore };
}

/**
 * "Edit an earlier message": hides `messageId` and every later message of the
 * conversation from the chat and from the AI's memory. Nothing is deleted —
 * the outputs those messages produced (and their approvals) stay in Files.
 * @returns {Promise<number>} how many messages were hidden
 */
export async function supersedeFrom(tx, conversationId, messageId) {
  const { rowCount } = await tx.query(
    `update ${T} m
        set metadata = m.metadata || jsonb_build_object('supersededAt', to_jsonb(clock_timestamp()), 'supersededBy', $3::text)
       from ${T} b
      where b.id = $2::uuid and b.conversation_id = $1
        and m.conversation_id = $1
        and m.metadata ->> 'supersededAt' is null
        and (m.created_at, m.id) >= (b.created_at, b.id)`,
    [conversationId, messageId, messageId],
  );
  return rowCount;
}

/**
 * True when `messageId` is a (non-system) message of `conversationId`.
 * @param {object} tx
 * @param {string} conversationId
 * @param {string} messageId
 */
export async function messageBelongs(tx, conversationId, messageId) {
  const { rows } = await tx.query(`select 1 from ${T} where id = $1 and conversation_id = $2 and role <> 'system'`, [messageId, conversationId]);
  return rows.length > 0;
}
