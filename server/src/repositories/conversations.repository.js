import { iso, toolId, userColumns, userSummary } from '../utils/mappers.js';

/**
 * Conversations repository: SQL + row → Conversation DTO mapping.
 * Message counts and the last-message preview never include system messages.
 */

const C = 'public.ai_workspace_conversations';
const M = 'public.ai_workspace_messages';
const O = 'public.ai_workspace_outputs';
const U = 'public.ai_workspace_users';
const TASKS = 'public.ai_workspace_tasks';

const SELECT = `c.id, c.task_id, c.job_id, c.client_id, c.title, c.tool_type, c.created_by, c.created_at, c.updated_at, c.archived_at,
  ${userColumns('u', 'cu_')},
  (select count(*)::int from ${M} m where m.conversation_id = c.id and m.role <> 'system' and m.metadata ->> 'supersededAt' is null) as message_count,
  (select count(*)::int from ${O} o where o.conversation_id = c.id and o.archived_at is null) as output_count,
  lm.role as last_role, lm.content as last_content, lm.created_at as last_created_at`;

const FROM = `${C} c
  left join ${U} u on u.id = c.created_by
  left join lateral (
    select m.role, left(m.content, 200) as content, m.created_at from ${M} m
     where m.conversation_id = c.id and m.role <> 'system' and m.metadata ->> 'supersededAt' is null
     order by m.created_at desc, m.id desc limit 1
  ) lm on true`;

const truncate = (text, n) => (text && text.length > n ? `${text.slice(0, n).trimEnd()}…` : text || '');

/**
 * Row → Conversation DTO.
 * @param {object} row
 */
export function toConversationDto(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    jobId: row.job_id,
    clientId: row.client_id,
    title: row.title,
    tool: toolId(row.tool_type),
    archived: !!row.archived_at,
    archivedAt: iso(row.archived_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by,
    messageCount: row.message_count ?? 0,
    outputCount: row.output_count ?? 0,
    lastMessage: row.last_role ? { role: row.last_role, content: truncate(row.last_content, 90), createdAt: iso(row.last_created_at) } : null,
    createdByUser: userSummary(row, 'cu_'),
  };
}

/**
 * Task scope row used to create conversations ({ id, client_id, job_id, archived_at }).
 * @param {object} tx
 * @param {string} taskId
 */
export async function getTaskScope(tx, taskId) {
  const { rows } = await tx.query(`select id, client_id, job_id, archived_at from ${TASKS} where id = $1`, [taskId]);
  return rows[0] || null;
}

/**
 * Conversations of a task, newest (updated) first.
 * @param {object} tx
 * @param {string} taskId
 * @param {{ includeArchived?: boolean|'only' }} [opts]
 */
export async function listByTask(tx, taskId, { includeArchived = false } = {}) {
  const archived = includeArchived === 'only' ? 'and c.archived_at is not null' : includeArchived ? '' : 'and c.archived_at is null';
  const { rows } = await tx.query(`select ${SELECT} from ${FROM} where c.task_id = $1 ${archived} order by c.updated_at desc, c.id desc limit 500`, [taskId]);
  return rows;
}

/**
 * One conversation (DTO-ready row) or null.
 * @param {object} tx
 * @param {string} id
 */
export async function getConversationRow(tx, id) {
  const { rows } = await tx.query(`select ${SELECT} from ${FROM} where c.id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Inserts a conversation; scope (client/job/task) must come from the task row.
 * @param {object} tx
 * @param {{ task: { id, client_id, job_id }, title: string, toolType: string|null, userId: string }} input
 * @returns {Promise<string>} new conversation id
 */
export async function insertConversation(tx, { task, title, toolType, userId }) {
  const { rows } = await tx.query(
    `insert into ${C} (client_id, job_id, task_id, title, tool_type, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $6) returning id`,
    [task.client_id, task.job_id, task.id, title, toolType, userId],
  );
  return rows[0].id;
}

/**
 * Applies a whitelisted patch. `fields` keys: title, tool_type, archived (boolean).
 * @param {object} tx
 * @param {string} id
 * @param {{ title?: string, tool_type?: string|null, archived?: boolean }} fields
 * @param {string} userId
 */
export async function updateConversation(tx, id, fields, userId) {
  const sets = ['updated_by = $2'];
  const params = [id, userId];
  if (fields.title !== undefined) {
    params.push(fields.title);
    sets.push(`title = $${params.length}`);
  }
  if (fields.tool_type !== undefined) {
    params.push(fields.tool_type);
    sets.push(`tool_type = $${params.length}`);
  }
  if (fields.archived !== undefined) {
    sets.push(fields.archived ? 'archived_at = coalesce(archived_at, now())' : 'archived_at = null');
  }
  const { rowCount } = await tx.query(`update ${C} set ${sets.join(', ')} where id = $1`, params);
  return rowCount > 0;
}

/**
 * Counts files (by id) of the given client that are not archived — used to
 * validate attachmentIds on user notes.
 * @param {object} tx
 * @param {string[]} fileIds
 * @param {string} clientId
 */
export async function countClientFiles(tx, fileIds, clientId) {
  const { rows } = await tx.query(
    `select count(*)::int as n from public.ai_workspace_files where id = any($1::uuid[]) and client_id = $2 and archived_at is null`,
    [fileIds, clientId],
  );
  return rows[0].n;
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Chat history across the workspace (newest activity first) with the client,
 * job and task each conversation belongs to.
 * @param {object} tx
 * @param {{ search?: string, clientId?: string, tool?: string, from?: string, to?: string, includeArchived?: boolean, limit: number, offset: number }} f
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listAll(tx, f) {
  const where = [f.includeArchived ? 'true' : 'c.archived_at is null'];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('$?', `$${params.length}`));
  };
  if (f.clientId) add('c.client_id = $?', f.clientId);
  if (f.toolType) add('c.tool_type = $?', f.toolType);
  // Date filters match any message written in the period, so "what did we write on 3 March" finds the chat.
  if (f.from || f.to) {
    const cond = [];
    if (f.from) {
      params.push(f.from);
      cond.push(`m.created_at >= $${params.length}::timestamptz`);
    }
    if (f.to) {
      params.push(f.to);
      cond.push(`m.created_at < $${params.length}::timestamptz`);
    }
    where.push(`exists (select 1 from ${M} m where m.conversation_id = c.id and m.role <> 'system' and ${cond.join(' and ')})`);
  }
  if (f.search) {
    add(
      `(c.title ilike $? escape '\\' or cl.name ilike $? escape '\\'
        or exists (select 1 from ${M} m where m.conversation_id = c.id and m.role <> 'system' and m.content ilike $? escape '\\'))`,
      `%${escapeLike(f.search)}%`,
    );
  }
  const base = `${FROM}
    join public.ai_workspace_clients cl on cl.id = c.client_id
    join public.ai_workspace_jobs j on j.id = c.job_id
    join ${TASKS} t on t.id = c.task_id
    where ${where.join(' and ')}`;
  const { rows } = await tx.query(
    `select ${SELECT}, cl.name as client_name, cl.primary_colour as client_colour, cl.status as client_status, j.title as job_title, t.title as task_title
       from ${base}
      order by coalesce(lm.created_at, c.updated_at) desc, c.id desc
      limit ${Number(f.limit)} offset ${Number(f.offset)}`,
    params,
  );
  const { rows: count } = await tx.query(`select count(*)::int as n from ${base}`, params);
  return { rows, total: count[0].n };
}

/** listAll row → history item DTO (conversation + where it belongs). */
export function toHistoryDto(row) {
  return {
    ...toConversationDto(row),
    lastActivityAt: iso(row.last_created_at || row.updated_at),
    client: { id: row.client_id, name: row.client_name, primaryColor: row.client_colour, status: row.client_status },
    job: { id: row.job_id, title: row.job_title },
    task: { id: row.task_id, title: row.task_title },
  };
}
