import { clientColumns, clientSummary, iso, jobColumns, jobSummary, taskColumns, taskSummary, toolId, userColumns, userSummary } from '../utils/mappers.js';

/*
 * Read-only aggregates for the dashboard, plus the compact File listing used by
 * the core modules (client reference files, job/task files, recent files).
 * The Files module owns the full File DTO (signed previews, versions); this
 * mapper produces the same field names for list views.
 */

/** Text outputs carry an excerpt of their current version for thumbnails, not the full content. */
const EXCERPT_CHARS = 1000;

const CATEGORY = { generated: 'output', reference: 'reference', attachment: 'attachment', logo: 'logo' };

/** Maps a file row (with joins) to the File DTO used in list views. */
function mapFile(row) {
  const hasOutput = Boolean(row.out_id);
  const status = hasOutput ? (row.out_approved_version_id ? 'approved' : 'draft') : null;
  const pendingRevision = hasOutput && Boolean(row.out_approved_version_id) && row.out_current_version_id !== row.out_approved_version_id;
  const versionCount = hasOutput ? row.out_version_count : Math.max(1, row.file_version_count);
  return {
    id: row.id,
    name: row.file_name,
    kind: row.file_category,
    mimeType: row.mime_type,
    size: Number(row.file_size_bytes),
    clientId: row.client_id,
    jobId: row.f_job_id,
    taskId: row.f_task_id,
    outputId: row.output_id,
    category: CATEGORY[row.source_type],
    storage: 'supabase',
    description: row.description,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: row.created_by,
    client: clientSummary(row),
    job: jobSummary(row),
    task: taskSummary(row),
    createdByUser: userSummary(row, 'cu_'),
    status,
    pendingRevision,
    lastRevisionAt: iso(hasOutput ? row.out_updated_at : row.updated_at),
    versionCount,
    output: hasOutput
      ? {
          id: row.out_id,
          title: row.out_title,
          kind: row.out_kind,
          tool: toolId(row.out_tool),
          status,
          pendingRevision,
          versionCount: row.out_version_count,
          currentVersionId: row.out_current_version_id,
          approvedVersionId: row.out_approved_version_id,
          conversationId: row.out_conversation_id,
          updatedAt: iso(row.out_updated_at),
          currentVersion: row.cv_id
            ? {
                id: row.cv_id,
                outputId: row.out_id,
                versionNumber: row.cv_version_number,
                kind: row.out_kind,
                content: row.cv_excerpt,
                contentTruncated: row.cv_content_length > EXCERPT_CHARS,
                sections: row.cv_sections,
                status: row.cv_approval_status,
                createdAt: iso(row.cv_created_at),
              }
            : null,
        }
      : null,
    conversation: row.conv_id ? { id: row.conv_id, title: row.conv_title, taskId: row.conv_task_id } : null,
  };
}

const FILE_ORDER = { updated: 'f.updated_at desc, f.id', created: 'f.created_at desc, f.id' };

/**
 * Lists active (non-archived) files in a scope.
 * `previewPaths` maps image file ids to their storage path so callers can sign
 * preview URLs outside the transaction; paths are never exposed in DTOs.
 * @param {{ clientId?, jobId?, taskId?, sourceTypes?: string[], sort?: 'updated'|'created', limit: number, offset?: number }} q
 * @returns {Promise<{ items: object[], total: number, previewPaths: Map<string,string> }>}
 */
export async function listFiles(tx, { clientId, jobId, taskId, sourceTypes, sort = 'updated', limit, offset = 0 }) {
  const params = [];
  const where = ['f.archived_at is null'];
  const eq = (column, value) => {
    if (!value) return;
    params.push(value);
    where.push(`${column} = $${params.length}`);
  };
  eq('f.client_id', clientId);
  eq('f.job_id', jobId);
  eq('f.task_id', taskId);
  if (sourceTypes?.length) {
    params.push(sourceTypes);
    where.push(`f.source_type = any($${params.length}::text[])`);
  }
  params.push(limit, offset);
  const { rows } = await tx.query(
    `select f.id, f.file_name, f.file_category, f.mime_type, f.file_size_bytes, f.output_id, f.source_type, f.description,
            f.created_at, f.updated_at, f.created_by, f.job_id as f_job_id, f.task_id as f_task_id,
            ${clientColumns('c')}, ${jobColumns('j')}, ${taskColumns('t')}, ${userColumns('u', 'cu_')},
            o.id as out_id, o.title as out_title, o.output_kind as out_kind, o.tool_type as out_tool,
            o.current_version_id as out_current_version_id, o.approved_version_id as out_approved_version_id,
            o.conversation_id as out_conversation_id, o.updated_at as out_updated_at,
            (select count(*)::int from public.ai_workspace_output_versions ov where ov.output_id = o.id) as out_version_count,
            (select count(*)::int from public.ai_workspace_file_versions fv where fv.file_id = f.id) as file_version_count,
            f.storage_path, ov.id as cv_id, ov.version_number as cv_version_number, ov.sections as cv_sections,
            left(ov.content, ${EXCERPT_CHARS}) as cv_excerpt, char_length(ov.content) as cv_content_length,
            ov.approval_status as cv_approval_status, ov.created_at as cv_created_at,
            cv.id as conv_id, cv.title as conv_title, cv.task_id as conv_task_id,
            count(*) over() as total_count
       from public.ai_workspace_files f
       join public.ai_workspace_clients c on c.id = f.client_id
       left join public.ai_workspace_jobs j on j.id = f.job_id
       left join public.ai_workspace_tasks t on t.id = f.task_id
       left join public.ai_workspace_users u on u.id = f.created_by
       left join public.ai_workspace_outputs o on o.id = f.output_id
       left join public.ai_workspace_output_versions ov on ov.id = o.current_version_id
       left join public.ai_workspace_conversations cv on cv.id = coalesce(f.conversation_id, o.conversation_id)
      where ${where.join(' and ')}
      order by ${FILE_ORDER[sort] || FILE_ORDER.updated}
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  const previewPaths = new Map(rows.filter((r) => r.storage_path && r.file_category === 'image').map((r) => [r.id, r.storage_path]));
  return { items: rows.map(mapFile), total: Number(rows[0]?.total_count || 0), previewPaths };
}

/** Headline counts for the dashboard metric cards (one round trip, SQL aggregates only). */
export async function metricCounts(tx) {
  const { rows } = await tx.query(`
    select
      (select count(*)::int from public.ai_workspace_clients where status <> 'archived') as clients,
      (select count(*)::int from public.ai_workspace_clients where created_at >= now() - interval '30 days') as clients_30d,
      (select count(*)::int from public.ai_workspace_jobs where status = 'active') as active_jobs,
      (select count(*)::int from public.ai_workspace_jobs where status = 'on_hold') as on_hold_jobs,
      (select count(*)::int from public.ai_workspace_tasks where status <> 'done' and archived_at is null) as open_tasks,
      (select count(*)::int from public.ai_workspace_tasks where status = 'review' and archived_at is null) as review_tasks,
      (select count(*)::int from public.ai_workspace_files where archived_at is null) as files,
      (select count(*)::int from public.ai_workspace_files
        where archived_at is null and source_type = 'generated' and created_at >= now() - interval '7 days') as generated_7d,
      o.drafts, o.draft_revisions, o.approved,
      (select count(*)::int from public.ai_workspace_output_versions where approved_at >= now() - interval '7 days') as approved_7d
    from (
      select count(*) filter (where current_version_id is distinct from approved_version_id)::int as drafts,
             count(*) filter (where approved_version_id is not null and current_version_id is distinct from approved_version_id)::int as draft_revisions,
             count(*) filter (where approved_version_id is not null)::int as approved
        from public.ai_workspace_outputs where archived_at is null
    ) o`);
  return rows[0];
}

/** Generated vs approved output versions per UTC day for the last `days` days (oldest first). */
export async function dailyVersionChart(tx, days = 14) {
  const { rows } = await tx.query(
    `with bounds as (select (now() at time zone 'UTC')::date - ($1::int - 1) as first_day),
     days as (
       select generate_series(b.first_day, (now() at time zone 'UTC')::date, interval '1 day')::date as day from bounds b
     ),
     generated as (
       select (v.created_at at time zone 'UTC')::date as day, count(*)::int as n
         from public.ai_workspace_output_versions v, bounds b
        where v.created_at >= b.first_day::timestamp at time zone 'UTC'
        group by 1
     ),
     approved as (
       select (v.approved_at at time zone 'UTC')::date as day, count(*)::int as n
         from public.ai_workspace_output_versions v, bounds b
        where v.approved_at >= b.first_day::timestamp at time zone 'UTC'
        group by 1
     )
     select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(g.n, 0) as generated, coalesce(a.n, 0) as approved
       from days d
       left join generated g on g.day = d.day
       left join approved a on a.day = d.day
      order by d.day`,
    [days],
  );
  return rows.map((r) => ({ date: `${r.day}T00:00:00.000Z`, generated: r.generated, approved: r.approved }));
}
