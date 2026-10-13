import { userColumns } from '../utils/mappers.js';

/**
 * SQL for immutable output versions. Versions are only ever created through
 * `ai_workspace_create_output_version` and approved through
 * `ai_workspace_approve_output_version`; content columns are never updated.
 */

const VERSION_SELECT = `
  select v.*, o.output_kind,
         fv.storage_path as fv_storage_path, fv.file_name as fv_file_name, fv.mime_type as fv_mime_type,
         fv.file_size_bytes as fv_size, fv.metadata as fv_metadata,
         ${userColumns('vu', 'creator_')},
         ${userColumns('au', 'approver_')}
    from public.ai_workspace_output_versions v
    join public.ai_workspace_outputs o on o.id = v.output_id
    left join public.ai_workspace_file_versions fv on fv.id = v.file_version_id
    left join public.ai_workspace_users vu on vu.id = v.created_by
    left join public.ai_workspace_users au on au.id = v.approved_by`;

/** All versions of the given outputs, oldest first. */
export async function listVersionsByOutputIds(tx, outputIds) {
  if (!outputIds.length) return [];
  const { rows } = await tx.query(`${VERSION_SELECT} where v.output_id = any($1::uuid[]) order by v.output_id, v.version_number asc`, [outputIds]);
  return rows;
}

export async function listVersionsByIds(tx, ids) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return [];
  const { rows } = await tx.query(`${VERSION_SELECT} where v.id = any($1::uuid[])`, [clean]);
  return rows;
}

/** One version that belongs to the given output (null otherwise). */
export async function findVersion(tx, outputId, versionId) {
  const { rows } = await tx.query(`${VERSION_SELECT} where v.output_id = $1 and v.id = $2`, [outputId, versionId]);
  return rows[0] || null;
}

/**
 * Creates the next version atomically (row lock + unique version number).
 * @returns {Promise<object>} the inserted ai_workspace_output_versions row
 */
export async function createOutputVersion(tx, { outputId, content = null, sections = null, missing = null, imageMeta = null, fileVersionId = null, note = '', sourceVersionId = null }) {
  const { rows } = await tx.query(
    `select * from public.ai_workspace_create_output_version($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8)`,
    [
      outputId,
      content,
      sections == null ? null : JSON.stringify(sections),
      missing == null ? null : JSON.stringify(missing),
      imageMeta == null ? null : JSON.stringify(imageMeta),
      fileVersionId,
      String(note || '').slice(0, 500),
      sourceVersionId,
    ],
  );
  return rows[0];
}
