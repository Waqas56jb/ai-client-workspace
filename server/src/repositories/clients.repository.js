import { iso, userColumns, userSummary } from '../utils/mappers.js';

/* ── SQL helpers shared by the core repositories ─────────────────────────── */

/** Paging for list endpoints: without page/limit the UI receives the full filtered list. */
export const LIST_PAGING = { defaultLimit: 200, maxLimit: 500 };

/** Escapes LIKE wildcards so user input is matched literally: `%term%`. */
export const likePattern = (term) => `%${String(term).replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Builds `col = $n` assignments for the whitelisted keys present in `values`.
 * @param {Record<string,string>} columns API field → column whitelist
 * @param {object} values parsed request values
 * @param {any[]} params parameter array to append to (mutated)
 * @returns {string[]} assignment fragments
 */
export function assignments(columns, values, params) {
  return Object.entries(columns)
    .filter(([key]) => values[key] !== undefined)
    .map(([key, column]) => {
      params.push(values[key]);
      return `${column} = $${params.length}`;
    });
}

/* ── Client column maps ──────────────────────────────────────────────────── */

/** Client detail fields → columns. `address` is the business address shared with the brand. */
export const CLIENT_COLUMNS = {
  name: 'name',
  slug: 'slug',
  industry: 'industry',
  status: 'status',
  description: 'description',
  address: 'business_address',
  contactName: 'contact_name',
  email: 'contact_email',
  phone: 'contact_phone',
  website: 'website',
  notes: 'internal_notes',
};

/** Brand profile fields stored in dedicated columns. */
export const BRAND_COLUMNS = {
  logoFileId: 'logo_file_id',
  primaryColor: 'primary_colour',
  secondaryColor: 'secondary_colour',
  accentColor: 'accent_colour',
  backgroundColor: 'background_colour',
  fontFamily: 'font_family',
  headingFont: 'heading_font',
  bodyFont: 'body_font',
  guidelines: 'brand_guidelines',
  businessName: 'business_name',
  address: 'business_address',
  phone: 'business_phone',
  email: 'business_email',
  website: 'business_website',
  warranty: 'approved_warranty_wording',
  disclaimers: 'standard_disclaimers',
  terms: 'standard_terms',
  legal: 'legal_wording',
  referenceNotes: 'reference_notes',
  productInfo: 'product_info',
  targetAudience: 'target_audience',
  imageStyle: 'image_style',
  otherInstructions: 'other_instructions',
};

/** Brand fields stored as keys of the `writing_preferences` jsonb object. */
export const WRITING_KEYS = ['tone', 'formality', 'spelling', 'useWords', 'avoidWords', 'formatting', 'writingInstructions'];

export const WRITING_DEFAULTS = { tone: 'Professional', formality: 'Balanced', spelling: 'British English', useWords: '', avoidWords: '', formatting: '', writingInstructions: '' };

const SELECT_COLUMNS = [
  'id', 'name', 'slug', 'industry', 'status', 'description', 'contact_name', 'contact_email', 'contact_phone', 'website',
  'internal_notes', 'writing_preferences', 'created_by', 'created_at', 'updated_at', 'archived_at',
  ...new Set(Object.values(BRAND_COLUMNS)),
].map((c) => `c.${c}`).join(', ');

const COUNTS = `
  (select count(*)::int from public.ai_workspace_jobs j where j.client_id = c.id and j.status <> 'archived') as job_count,
  (select count(*)::int from public.ai_workspace_jobs j where j.client_id = c.id and j.status = 'active') as active_job_count,
  (select count(*)::int from public.ai_workspace_tasks t where t.client_id = c.id and t.archived_at is null) as task_count,
  (select count(*)::int from public.ai_workspace_files f where f.client_id = c.id and f.archived_at is null) as file_count,
  oc.draft_count, oc.approved_count,
  greatest(c.updated_at, (select max(a.created_at) from public.ai_workspace_activity_logs a where a.client_id = c.id)) as last_activity_at`;

const OUTPUT_COUNTS = `
  left join lateral (
    select count(*) filter (where o.current_version_id is distinct from o.approved_version_id)::int as draft_count,
           count(*) filter (where o.approved_version_id is not null)::int as approved_count
      from public.ai_workspace_outputs o
     where o.client_id = c.id and o.archived_at is null
  ) oc on true`;

const SORTS = {
  recent: 'last_activity_at desc, id',
  name: 'lower(name) asc, id',
  created: 'created_at desc, id',
  jobs: 'job_count desc, lower(name) asc, id',
};

/** Maps a client row (with counts) to the Client DTO. */
export function mapClient(row) {
  const prefs = { ...WRITING_DEFAULTS, ...(row.writing_preferences || {}) };
  const brand = Object.fromEntries(Object.entries(BRAND_COLUMNS).map(([key, col]) => [key, row[col] ?? '']));
  brand.logoFileId = row.logo_file_id || null;
  WRITING_KEYS.forEach((k) => (brand[k] = String(prefs[k] ?? '')));
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    industry: row.industry,
    status: row.status,
    description: row.description,
    address: row.business_address,
    contactName: row.contact_name,
    email: row.contact_email,
    phone: row.contact_phone,
    website: row.website,
    notes: row.internal_notes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    archivedAt: iso(row.archived_at),
    createdBy: row.created_by,
    brand,
    jobCount: row.job_count ?? 0,
    activeJobCount: row.active_job_count ?? 0,
    taskCount: row.task_count ?? 0,
    fileCount: row.file_count ?? 0,
    draftCount: row.draft_count ?? 0,
    approvedCount: row.approved_count ?? 0,
    lastActivityAt: iso(row.last_activity_at || row.updated_at),
    createdByUser: userSummary(row, 'cu_'),
  };
}

/**
 * Lists clients with counts, filtering, sorting and pagination.
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function listClients(tx, { search, status, includeArchived, sort, limit, offset }) {
  const params = [];
  const where = [];
  if (status && status !== 'all') {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  } else if (!includeArchived && status !== 'all') {
    where.push(`c.status <> 'archived'`);
  }
  if (search) {
    params.push(likePattern(search));
    const p = `$${params.length}`;
    where.push(`(c.name ilike ${p} or c.industry ilike ${p} or c.slug ilike ${p})`);
  }
  params.push(limit, offset);
  const { rows } = await tx.query(
    `with base as (
       select ${SELECT_COLUMNS}, ${COUNTS}
         from public.ai_workspace_clients c ${OUTPUT_COUNTS}
        ${where.length ? `where ${where.join(' and ')}` : ''}
     )
     select b.*, ${userColumns('u', 'cu_')}, count(*) over() as total_count
       from base b left join public.ai_workspace_users u on u.id = b.created_by
      order by ${SORTS[sort] || SORTS.recent}
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { items: rows.map(mapClient), total: Number(rows[0]?.total_count || 0) };
}

/** Finds one client (any status) with counts, or null. */
export async function findClient(tx, clientId) {
  const { rows } = await tx.query(
    `select ${SELECT_COLUMNS}, ${COUNTS}, ${userColumns('u', 'cu_')}
       from public.ai_workspace_clients c ${OUTPUT_COUNTS}
       left join public.ai_workspace_users u on u.id = c.created_by
      where c.id = $1`,
    [clientId],
  );
  return rows[0] ? mapClient(rows[0]) : null;
}

/** Returns the minimal client row used for business checks (optionally row-locked), or null. */
export async function clientRow(tx, clientId, { lock = false } = {}) {
  const { rows } = await tx.query(`select id, name, slug, status from public.ai_workspace_clients where id = $1${lock ? ' for update' : ''}`, [clientId]);
  return rows[0] || null;
}

/** True when another client already uses `slug`. */
export async function slugTaken(tx, slug, exceptId = null) {
  const { rows } = await tx.query('select 1 from public.ai_workspace_clients where slug = $1 and id is distinct from $2', [slug, exceptId]);
  return rows.length > 0;
}

/**
 * Inserts a client. `values` uses API field names; `brand` contains brand fields.
 * @returns {Promise<string>} new client id
 */
export async function insertClient(tx, { values, brand, writingPreferences, userId }) {
  const cols = [];
  const params = [];
  const add = (column, value) => {
    if (value === undefined) return;
    cols.push(column);
    params.push(value);
  };
  Object.entries(CLIENT_COLUMNS).forEach(([key, col]) => add(col, values[key]));
  Object.entries(BRAND_COLUMNS).forEach(([key, col]) => {
    if (!cols.includes(col)) add(col, brand[key]);
  });
  add('writing_preferences', writingPreferences);
  add('created_by', userId);
  add('updated_by', userId);
  const { rows } = await tx.query(
    `insert into public.ai_workspace_clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    params,
  );
  return rows[0].id;
}

/**
 * Updates client detail / brand columns and merges writing preferences.
 * @param {{ columns: Record<string,string>, values: object, writing?: object, extra?: string[] }} spec
 */
export async function updateClient(tx, clientId, userId, { columns, values, writing, extra = [] }) {
  const params = [clientId, userId];
  const sets = [...assignments(columns, values, params), ...extra, 'updated_by = $2'];
  if (writing && Object.keys(writing).length) {
    params.push(writing);
    sets.push(`writing_preferences = writing_preferences || $${params.length}::jsonb`);
  }
  await tx.query(`update public.ai_workspace_clients set ${sets.join(', ')} where id = $1`, params);
}

/** True when `fileId` is an active image file that belongs to `clientId`. */
export async function isClientImageFile(tx, clientId, fileId) {
  const { rows } = await tx.query(
    `select 1 from public.ai_workspace_files
      where id = $1 and client_id = $2 and archived_at is null and mime_type like 'image/%'`,
    [fileId, clientId],
  );
  return rows.length > 0;
}

/** Counts everything that references the client (archived rows included). */
export async function deletionImpact(tx, clientId) {
  const { rows } = await tx.query(
    `select (select count(*)::int from public.ai_workspace_jobs where client_id = $1) as jobs,
            (select count(*)::int from public.ai_workspace_tasks where client_id = $1) as tasks,
            (select count(*)::int from public.ai_workspace_files where client_id = $1) as files,
            (select count(*)::int from public.ai_workspace_outputs where client_id = $1) as outputs`,
    [clientId],
  );
  return rows[0];
}

/** Reads the workspace's default tone / spelling to seed a new client's writing preferences. */
export async function workspaceWritingDefaults(tx) {
  const { rows } = await tx.query('select default_tone, default_spelling_convention from public.ai_workspace_settings where id = 1');
  return rows[0] ? { tone: rows[0].default_tone, spelling: rows[0].default_spelling_convention } : {};
}

/**
 * Counts the client-bound work (conversations, outputs, files) under a job or
 * task. Such work must not be moved to another client: its history, approved
 * versions and AI context belong to the original client.
 * @param {object} tx
 * @param {{ jobId?: string, taskId?: string }} scope
 */
export async function countClientBoundWork(tx, { jobId, taskId }) {
  const col = taskId ? 'task_id' : 'job_id';
  const id = taskId || jobId;
  const { rows } = await tx.query(
    `select (select count(*) from public.ai_workspace_conversations where ${col} = $1)
          + (select count(*) from public.ai_workspace_outputs where ${col} = $1)
          + (select count(*) from public.ai_workspace_files where ${col} = $1) as n`,
    [id],
  );
  return Number(rows[0].n);
}

export const CROSS_CLIENT_MOVE_MESSAGE =
  'This already has conversations, AI outputs or files for its client, so it cannot be moved to a different client. Create new work under the other client instead.';
