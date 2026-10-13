/**
 * Search repository. Every group query is bounded (`limit`) and evaluated in
 * the database under RLS — nothing is loaded wholesale into memory.
 *
 * Matching (parameters $1..$3 are shared by every group query):
 *   $1 websearch text  → `search_vector @@ websearch_to_tsquery('simple', $1)` (GIN-indexed)
 *   $2 prefix tsquery  → `search_vector @@ to_tsquery('simple', $2)`, e.g. 'cup:* & pos:*'
 *                         built only from sanitised letter/digit tokens (GIN-indexed, partial words)
 *   $3 ILIKE pattern   → '%term%' with %, _ and \ escaped, applied to short title-like columns
 * Message bodies and version contents are matched by the indexed tsvector paths only.
 */

const T = {
  clients: 'public.ai_workspace_clients',
  jobs: 'public.ai_workspace_jobs',
  tasks: 'public.ai_workspace_tasks',
  conversations: 'public.ai_workspace_conversations',
  messages: 'public.ai_workspace_messages',
  files: 'public.ai_workspace_files',
  outputs: 'public.ai_workspace_outputs',
  versions: 'public.ai_workspace_output_versions',
};

/** Escapes LIKE metacharacters (backslash is the escape character). */
export const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Builds the shared match parameters for a raw query string.
 * @param {string} q trimmed query
 * @returns {[string, string|null, string]} [$1 websearch text, $2 prefix tsquery or null, $3 ILIKE pattern]
 */
export function matchParams(q) {
  const tokens = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
  const prefix = tokens.length ? tokens.map((t) => `${t}:*`).join(' & ') : null;
  return [q, prefix, `%${escapeLike(q)}%`];
}

const tsMatch = (sv) => `(${sv} @@ websearch_to_tsquery('simple', $1) or ${sv} @@ to_tsquery('simple', $2))`;
const likeMatch = (cols) => cols.map((c) => `${c} ilike $3 escape '\\'`).join(' or ');
const match = (sv, cols) => `(${tsMatch(sv)} or ${likeMatch(cols)})`;
const rank = (sv) => `ts_rank(${sv}, websearch_to_tsquery('simple', $1))`;

/** Collects parameterised WHERE fragments after the 3 shared match params. */
function where(base) {
  const params = [...base];
  const parts = [];
  return {
    params,
    parts,
    raw(sql) {
      parts.push(sql);
    },
    add(sql, value) {
      if (value === undefined || value === null || value === '') return;
      params.push(value);
      parts.push(sql.replaceAll('$?', `$${params.length}`));
    },
    limit(n) {
      params.push(n);
      return `$${params.length}`;
    },
    sql: () => (parts.length ? ` and ${parts.join(' and ')}` : ''),
  };
}

/**
 * @typedef {{ clientId?: string, jobId?: string, taskId?: string, interval?: string, fileKind?: string, approval?: string }} SearchFilters
 */

/** Clients by name/industry/description/contact/slug. */
export async function searchClients(tx, m, f, limit) {
  const w = where(m);
  w.add('c.id = $?', f.clientId);
  w.add('c.updated_at >= now() - $?::interval', f.interval);
  const lim = w.limit(limit);
  const { rows } = await tx.query(
    `select c.id, c.name, c.industry, c.description, c.status, c.updated_at, ${rank('c.search_vector')} as rank
       from ${T.clients} c
      where ${match('c.search_vector', ['c.name', 'c.industry', 'c.contact_name', 'c.slug'])}${w.sql()}
      order by rank desc, c.updated_at desc limit ${lim}`,
    w.params,
  );
  return rows;
}

/** Jobs by title/description/notes. */
export async function searchJobs(tx, m, f, limit) {
  const w = where(m);
  w.add('j.client_id = $?', f.clientId);
  w.add('j.id = $?', f.jobId);
  w.add('j.updated_at >= now() - $?::interval', f.interval);
  const lim = w.limit(limit);
  const { rows } = await tx.query(
    `select j.id, j.client_id, j.title, j.description, j.status, j.updated_at, cl.name as client_name, ${rank('j.search_vector')} as rank
       from ${T.jobs} j join ${T.clients} cl on cl.id = j.client_id
      where ${match('j.search_vector', ['j.title'])}${w.sql()}
      order by rank desc, j.updated_at desc limit ${lim}`,
    w.params,
  );
  return rows;
}

/** Tasks by title/description/notes. */
export async function searchTasks(tx, m, f, limit) {
  const w = where(m);
  w.add('t.client_id = $?', f.clientId);
  w.add('t.job_id = $?', f.jobId);
  w.add('t.id = $?', f.taskId);
  w.add('t.updated_at >= now() - $?::interval', f.interval);
  const lim = w.limit(limit);
  const { rows } = await tx.query(
    `select t.id, t.client_id, t.job_id, t.title, t.description, t.task_type, t.status, t.updated_at,
            cl.name as client_name, j.title as job_title, ${rank('t.search_vector')} as rank
       from ${T.tasks} t join ${T.clients} cl on cl.id = t.client_id join ${T.jobs} j on j.id = t.job_id
      where ${match('t.search_vector', ['t.title'])}${w.sql()}
      order by rank desc, t.updated_at desc limit ${lim}`,
    w.params,
  );
  return rows;
}

/**
 * Conversations whose title matches or that contain a matching (non-system)
 * message; one row per conversation with the latest matching message as excerpt source.
 */
export async function searchConversations(tx, m, f, limit) {
  const w = where(m);
  w.add('c.client_id = $?', f.clientId);
  w.add('c.job_id = $?', f.jobId);
  w.add('c.task_id = $?', f.taskId);
  w.add('c.updated_at >= now() - $?::interval', f.interval);
  const lim = w.limit(limit);
  const { rows } = await tx.query(
    `with hits as (
       select distinct on (mm.conversation_id) mm.conversation_id, left(mm.content, 20000) as content
         from ${T.messages} mm
        where mm.role <> 'system' and ${tsMatch('mm.search_vector')}
        order by mm.conversation_id, mm.created_at desc
     )
     select c.id, c.client_id, c.job_id, c.task_id, c.title, c.updated_at, h.content as message_content,
            cl.name as client_name, j.title as job_title, t.title as task_title
       from ${T.conversations} c
       join ${T.tasks} t on t.id = c.task_id
       join ${T.jobs} j on j.id = c.job_id
       join ${T.clients} cl on cl.id = c.client_id
       left join hits h on h.conversation_id = c.id
      where c.archived_at is null and (h.conversation_id is not null or ${likeMatch(['c.title'])})${w.sql()}
      order by (c.title ilike $3 escape '\\') desc, c.updated_at desc limit ${lim}`,
    w.params,
  );
  return rows;
}

const FILE_STATUS = `case when f.output_id is not null then (case when o.approved_version_id is not null then 'approved' else 'draft' end)
                         when f.approval_status = 'approved' then 'approved' else 'reference' end`;

/** Files by name/description, or by the CURRENT version text of generated outputs. */
export async function searchFiles(tx, m, f, limit) {
  const w = where(m);
  w.add('f.client_id = $?', f.clientId);
  w.add('f.job_id = $?', f.jobId);
  w.add('f.task_id = $?', f.taskId);
  w.add('f.updated_at >= now() - $?::interval', f.interval);
  w.add('f.file_category = $?', f.fileKind);
  w.add(`(${FILE_STATUS}) = $?`, f.approval);
  const lim = w.limit(limit);
  const { rows } = await tx.query(
    `select f.id, f.client_id, f.job_id, f.task_id, f.file_name, f.description, f.file_category, f.updated_at,
            ${FILE_STATUS} as status,
            left(cv.content, 20000) as version_content, cv.sections as version_sections, cv.image_meta->>'prompt' as version_prompt,
            (cv.id is not null and ${tsMatch('cv.search_vector')}) as content_hit,
            cl.name as client_name, j.title as job_title, t.title as task_title,
            greatest(${rank('f.search_vector')}, coalesce(${rank('cv.search_vector')}, 0)) as rank
       from ${T.files} f
       join ${T.clients} cl on cl.id = f.client_id
       left join ${T.jobs} j on j.id = f.job_id
       left join ${T.tasks} t on t.id = f.task_id
       left join ${T.outputs} o on o.id = f.output_id
       left join ${T.versions} cv on cv.id = o.current_version_id
      where f.archived_at is null
        and (${match('f.search_vector', ['f.file_name'])} or (cv.id is not null and ${tsMatch('cv.search_vector')}))${w.sql()}
      order by rank desc, f.updated_at desc limit ${lim}`,
    w.params,
  );
  return rows;
}

/** Approved outputs — matches the APPROVED version's title/content/sections only. */
export async function searchApproved(tx, m, f, limit) {
  const w = where(m);
  w.add('o.client_id = $?', f.clientId);
  w.add('o.job_id = $?', f.jobId);
  w.add('o.task_id = $?', f.taskId);
  w.add('v.approved_at >= now() - $?::interval', f.interval);
  if (f.fileKind) w.add(`(case when o.output_kind = 'image' then 'image' else 'text' end) = $?`, f.fileKind);
  const lim = w.limit(limit);
  const { rows } = await tx.query(
    `select o.id, o.client_id, o.job_id, o.task_id, o.title, o.output_kind, o.file_id,
            v.version_number, v.approved_at, left(v.content, 20000) as version_content, v.sections as version_sections,
            v.image_meta->>'prompt' as version_prompt,
            cl.name as client_name, j.title as job_title, t.title as task_title, ${rank('v.search_vector')} as rank
       from ${T.outputs} o
       join ${T.versions} v on v.id = o.approved_version_id and v.approval_status = 'approved'
       join ${T.clients} cl on cl.id = o.client_id
       join ${T.jobs} j on j.id = o.job_id
       join ${T.tasks} t on t.id = o.task_id
      where o.archived_at is null and ${match('v.search_vector', ['v.title'])}${w.sql()}
      order by rank desc, v.approved_at desc limit ${lim}`,
    w.params,
  );
  return rows;
}
