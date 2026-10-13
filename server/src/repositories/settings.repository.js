import { iso } from '../utils/mappers.js';

/** Preferences DTO field → settings column. */
export const SETTINGS_COLUMNS = {
  workspaceName: 'workspace_name',
  writingPreferences: 'general_writing_preferences',
  spelling: 'default_spelling_convention',
  defaultTone: 'default_tone',
  dateFormat: 'date_format',
  defaultFileView: 'default_file_view',
  defaultPresetId: 'default_image_preset_id',
};

/** Maps the settings row to the Preferences DTO. */
function mapSettings(row) {
  const dto = Object.fromEntries(Object.entries(SETTINGS_COLUMNS).map(([key, col]) => [key, row[col]]));
  dto.defaultPresetId = row.default_image_preset_id || null;
  dto.updatedAt = iso(row.updated_at);
  return dto;
}

/** Reads the single workspace settings row, or null when it has not been created yet. */
export async function findSettings(tx) {
  const { rows } = await tx.query(`select ${Object.values(SETTINGS_COLUMNS).join(', ')}, updated_at from public.ai_workspace_settings where id = 1`);
  return rows[0] ? mapSettings(rows[0]) : null;
}

/** Id of the active preset with `seedKey`, or null. */
export async function presetIdBySeedKey(tx, seedKey) {
  const { rows } = await tx.query('select id from public.ai_workspace_image_presets where seed_key = $1 and is_active', [seedKey]);
  return rows[0]?.id || null;
}

/** True when `presetId` references an active GLOBAL image preset (usable for every client). */
export async function isActivePreset(tx, presetId) {
  const { rows } = await tx.query('select 1 from public.ai_workspace_image_presets where id = $1 and is_active and client_id is null', [presetId]);
  return rows.length > 0;
}

/**
 * Creates or replaces the single settings row with the full preferences object.
 * @param {object} prefs complete Preferences DTO values
 */
export async function upsertSettings(tx, prefs, userId) {
  const cols = Object.values(SETTINGS_COLUMNS);
  const params = [...Object.keys(SETTINGS_COLUMNS).map((k) => prefs[k]), userId];
  const { rows } = await tx.query(
    `insert into public.ai_workspace_settings (id, ${cols.join(', ')}, updated_by)
     values (1, ${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${params.length})
     on conflict (id) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, updated_by = excluded.updated_by
     returning ${cols.join(', ')}, updated_at`,
    params,
  );
  return mapSettings(rows[0]);
}

/**
 * Record counts and storage usage computed from database rows only. Stored
 * objects are every file version plus any file object not recorded as a version
 * (so bytes are never double counted).
 */
export async function storageUsage(tx) {
  const { rows } = await tx.query(`
    with objects as (
      select f.source_type, fv.file_size_bytes as bytes
        from public.ai_workspace_file_versions fv
        join public.ai_workspace_files f on f.id = fv.file_id
      union all
      select f.source_type, f.file_size_bytes
        from public.ai_workspace_files f
       where f.storage_path is not null
         and not exists (select 1 from public.ai_workspace_file_versions fv
                          where fv.storage_bucket = f.storage_bucket and fv.storage_path = f.storage_path)
    ),
    bytes_by_source as (select source_type, sum(bytes)::text as bytes from objects group by source_type),
    files_by_source as (select source_type, count(*)::int as n from public.ai_workspace_files group by source_type),
    files_by_kind as (select file_category, count(*)::int as n from public.ai_workspace_files group by file_category)
    select
      (select count(*)::int from public.ai_workspace_clients) as clients,
      (select count(*)::int from public.ai_workspace_jobs) as jobs,
      (select count(*)::int from public.ai_workspace_tasks) as tasks,
      (select count(*)::int from public.ai_workspace_conversations) as conversations,
      (select count(*)::int from public.ai_workspace_messages) as messages,
      (select count(*)::int from public.ai_workspace_outputs) as outputs,
      (select count(*)::int from public.ai_workspace_output_versions) as versions,
      (select count(*)::int from public.ai_workspace_files) as files,
      (select coalesce(jsonb_object_agg(source_type, n), '{}'::jsonb) from files_by_source) as files_by_source,
      (select coalesce(jsonb_object_agg(source_type, bytes), '{}'::jsonb) from bytes_by_source) as bytes_by_source,
      (select coalesce(jsonb_object_agg(file_category, n), '{}'::jsonb) from files_by_kind) as files_by_kind`);
  return rows[0];
}
