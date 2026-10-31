import { iso } from '../utils/mappers.js';

/** What the assistant remembers about a client (see migration 0005). */
const T = 'public.ai_workspace_client_memories';
export const MAX_MEMORIES_PER_CLIENT = 80;

/**
 * Client memory needs migration 0005. Until it is applied, memory is simply off:
 * the chat keeps working and the memory endpoints say it is not set up yet.
 * (Checked with to_regclass, which never aborts the surrounding transaction.)
 */
let tableSeen = false;
let lastCheck = 0;
export async function memoryEnabled(tx) {
  if (tableSeen) return true;
  if (Date.now() - lastCheck < 60_000 && lastCheck) return false;
  lastCheck = Date.now();
  const { rows } = await tx.query(`select to_regclass('${T}') is not null as ok`);
  tableSeen = !!rows[0]?.ok;
  return tableSeen;
}

export const toMemoryDto = (r) => ({
  id: r.id,
  clientId: r.client_id,
  category: r.category,
  fact: r.fact,
  sourceConversationId: r.source_conversation_id || null,
  createdBy: r.created_by || null,
  createdAt: iso(r.created_at),
});

/** Oldest first, so "Memory 1" stays the same number while facts are added. */
export async function listForClient(tx, clientId, limit = MAX_MEMORIES_PER_CLIENT) {
  if (!(await memoryEnabled(tx))) return [];
  const { rows } = await tx.query(`select * from ${T} where client_id = $1 order by created_at asc, id asc limit $2`, [clientId, limit]);
  return rows;
}

export async function countForClient(tx, clientId) {
  const { rows } = await tx.query(`select count(*)::int as n from ${T} where client_id = $1`, [clientId]);
  return rows[0].n;
}

/** Inserts unless the same fact (ignoring case and spaces) is already stored. Returns the row or null. */
export async function insertMemory(tx, { clientId, category = 'fact', fact, conversationId = null, messageId = null, userId }) {
  const { rows } = await tx.query(
    `insert into ${T} (client_id, category, fact, source_conversation_id, source_message_id, created_by)
     select $1, $2, $3, $4, $5, $6
      where not exists (select 1 from ${T} where client_id = $1 and lower(regexp_replace(fact, '\\s+', ' ', 'g')) = lower(regexp_replace($3, '\\s+', ' ', 'g')))
     returning *`,
    [clientId, category, fact, conversationId, messageId, userId || null],
  );
  return rows[0] || null;
}

export async function deleteMemory(tx, clientId, id) {
  const { rows } = await tx.query(`delete from ${T} where id = $1 and client_id = $2 returning *`, [id, clientId]);
  return rows[0] || null;
}
