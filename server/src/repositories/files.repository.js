import { clientColumns, jobColumns, taskColumns, userColumns } from '../utils/mappers.js';
import { likePattern } from './outputs.repository.js';

/**
 * SQL for ai_workspace_files and their immutable physical versions
 * (ai_workspace_file_versions). Runs under RLS via `withUser`.
 */

const FILE_SELECT = `
  select f.*,
         ${clientColumns('c')},
         ${jobColumns('j')},
         ${taskColumns('t')},
         ${userColumns('cu', 'creator_')},
         o.output_kind, o.updated_at as output_updated_at,
         cv.id as conversation_id_ref, cv.title as conversation_title, cv.task_id as conversation_task_id,
         (select count(*)::int from public.ai_workspace_file_versions fvc where fvc.file_id = f.id) as file_version_count,
         (select fvm.metadata -> 'extract' from public.ai_workspace_file_versions fvm where fvm.id = f.current_version_id) as current_extract
    from public.ai_workspace_files f
    join public.ai_workspace_clients c on c.id = f.client_id
    left join public.ai_workspace_jobs j on j.id = f.job_id
    left join public.ai_workspace_tasks t on t.id = f.task_id
    left join public.ai_workspace_users cu on cu.id = f.created_by
    left join public.ai_workspace_outputs o on o.id = f.output_id
    left join public.ai_workspace_conversations cv on cv.id = coalesce(o.conversation_id, f.conversation_id)`;

/** Client row for upload validation. */
export async function findClient(tx, id) {
  const { rows } = await tx.query('select id, status, archived_at from public.ai_workspace_clients where id = $1', [id]);
  return rows[0] || null;
}

export async function findJob(tx, id) {
  const { rows } = await tx.query('select id, client_id, archived_at from public.ai_workspace_jobs where id = $1', [id]);
  return rows[0] || null;
}

export async function findTask(tx, id) {
  const { rows } = await tx.query('select id, client_id, job_id, archived_at from public.ai_workspace_tasks where id = $1', [id]);
  return rows[0] || null;
}

/** Inserts a file record. `id` may be pre-generated so storage paths can include it. */
export async function insertFile(tx, f) {
  const { rows } = await tx.query(
    `insert into public.ai_workspace_files
       (id, client_id, job_id, task_id, conversation_id, output_id, file_name, original_file_name, description,
        storage_path, mime_type, file_size_bytes, file_checksum, file_category, source_type, approval_status,
        created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
     returning *`,
    [
      f.id, f.clientId, f.jobId || null, f.taskId || null, f.conversationId || null, f.outputId || null,
      f.fileName, f.originalFileName || '', f.description || '', f.storagePath || null, f.mimeType, f.size,
      f.checksum || null, f.category, f.sourceType, f.approvalStatus || 'none', f.userId,
    ],
  );
  return rows[0];
}

/** Inserts an immutable physical file version. */
export async function insertFileVersion(tx, v) {
  const { rows } = await tx.query(
    `insert into public.ai_workspace_file_versions
       (file_id, version_number, storage_path, file_name, mime_type, file_size_bytes, file_checksum, metadata, revision_note, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     returning *`,
    [v.fileId, v.versionNumber, v.storagePath, v.fileName, v.mimeType, v.size, v.checksum, JSON.stringify(v.metadata || {}), String(v.note || '').slice(0, 500), v.userId],
  );
  return rows[0];
}

/** Points the file record at its current physical version (bytes, path, size, checksum). */
export async function setCurrentFileVersion(tx, fileId, fv, userId) {
  await tx.query(
    `update public.ai_workspace_files
        set current_version_id = $2, storage_path = $3, file_size_bytes = $4, file_checksum = $5, mime_type = $6, updated_by = $7
      where id = $1`,
    [fileId, fv.id, fv.storage_path, fv.file_size_bytes, fv.file_checksum, fv.mime_type, userId],
  );
}

export async function updateFileSize(tx, fileId, size, userId) {
  await tx.query('update public.ai_workspace_files set file_size_bytes = $2, updated_by = $3 where id = $1', [fileId, size, userId]);
}

export async function nextFileVersionNumber(tx, fileId) {
  const { rows } = await tx.query('select public.ai_workspace_next_file_version_number($1) as n', [fileId]);
  return rows[0].n;
}

export async function insertBrandAsset(tx, a) {
  await tx.query(
    `insert into public.ai_workspace_brand_assets (client_id, asset_type, title, description, file_id, created_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [a.clientId, a.assetType, String(a.title || '').slice(0, 160), a.description || '', a.fileId, a.userId],
  );
}

/** File with joins. Archived files are returned too (callers decide). */
export async function findFileById(tx, id) {
  const { rows } = await tx.query(`${FILE_SELECT} where f.id = $1`, [id]);
  return rows[0] || null;
}

export async function findFileRow(tx, id, { forUpdate = false } = {}) {
  const { rows } = await tx.query(`select * from public.ai_workspace_files where id = $1 ${forUpdate ? 'for update' : ''}`, [id]);
  return rows[0] || null;
}

export async function updateFileDetails(tx, id, { fileName, description }, userId) {
  const sets = ['updated_by = $2'];
  const params = [id, userId];
  if (fileName !== undefined) {
    params.push(fileName);
    sets.push(`file_name = $${params.length}`);
  }
  if (description !== undefined) {
    params.push(description);
    sets.push(`description = $${params.length}`);
  }
  const { rows } = await tx.query(`update public.ai_workspace_files set ${sets.join(', ')} where id = $1 returning *`, params);
  return rows[0] || null;
}

/** Soft-archives a file and detaches it as a client logo. Storage objects are kept. */
export async function archiveFile(tx, id, userId) {
  await tx.query('update public.ai_workspace_files set archived_at = now(), updated_by = $2 where id = $1 and archived_at is null', [id, userId]);
  await tx.query('update public.ai_workspace_clients set logo_file_id = null, updated_by = $2 where logo_file_id = $1', [id, userId]);
}

/** Renames the generated-output file record that belongs to an output. */
export async function renameOutputFile(tx, outputId, fileName, userId) {
  await tx.query('update public.ai_workspace_files set file_name = $2, updated_by = $3 where output_id = $1', [outputId, fileName, userId]);
}

const FILE_VERSION_SELECT = `
  select fv.*, ${userColumns('vu', 'creator_')}, ${userColumns('au', 'approver_')}
    from public.ai_workspace_file_versions fv
    left join public.ai_workspace_users vu on vu.id = fv.created_by
    left join public.ai_workspace_users au on au.id = fv.approved_by`;

export async function listFileVersions(tx, fileId) {
  const { rows } = await tx.query(`${FILE_VERSION_SELECT} where fv.file_id = $1 order by fv.version_number asc`, [fileId]);
  return rows;
}

export async function findFileVersion(tx, fileId, versionId) {
  const { rows } = await tx.query(`${FILE_VERSION_SELECT} where fv.file_id = $1 and fv.id = $2`, [fileId, versionId]);
  return rows[0] || null;
}

const FILE_SORTS = {
  updated: 'coalesce(o.updated_at, f.updated_at) desc, f.id',
  created: 'f.created_at desc, f.id',
  name: 'lower(f.file_name) asc, f.id',
  size: 'f.file_size_bytes desc, f.id',
};

/**
 * Lists files.
 * @param {object} q — { kind, status, clientId, jobId, taskId, category(source_type), createdBy, interval, search, sort, includeArchived }
 */
export async function listFiles(tx, q, { limit, offset }) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (!q.includeArchived) where.push('f.archived_at is null');
  if (q.kind) add('f.file_category = ?', q.kind);
  if (q.status === 'reference') where.push('f.output_id is null');
  if (q.status === 'approved') where.push('f.output_id is not null and o.approved_version_id is not null');
  if (q.status === 'draft') where.push('f.output_id is not null and o.approved_version_id is null');
  if (q.clientId) add('f.client_id = ?', q.clientId);
  if (q.jobId) add('f.job_id = ?', q.jobId);
  if (q.taskId) add('f.task_id = ?', q.taskId);
  if (q.category) add('f.source_type = ?', q.category);
  if (q.createdBy) add('f.created_by = ?', q.createdBy);
  if (q.interval) add('f.created_at >= now() - ?::interval', q.interval);
  if (q.search) {
    add(
      `(f.file_name ilike ? or f.description ilike ? or c.name ilike ? or coalesce(j.title, '') ilike ? or coalesce(t.title, '') ilike ?)`,
      likePattern(q.search),
    );
  }
  const whereSql = where.length ? `where ${where.join(' and ')}` : '';
  const from = `
    from public.ai_workspace_files f
    join public.ai_workspace_clients c on c.id = f.client_id
    left join public.ai_workspace_jobs j on j.id = f.job_id
    left join public.ai_workspace_tasks t on t.id = f.task_id
    left join public.ai_workspace_outputs o on o.id = f.output_id`;
  const { rows: countRows } = await tx.query(`select count(*)::int as n ${from} ${whereSql}`, params);
  const order = FILE_SORTS[q.sort] || FILE_SORTS.updated;
  const { rows } = await tx.query(
    `${FILE_SELECT} ${whereSql} order by ${order} limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit, offset],
  );
  return { rows, total: countRows[0].n };
}
