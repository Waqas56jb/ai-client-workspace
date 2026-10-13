/** Insert-if-missing seed of AI instructions, starter presets and workspace settings. Never overwrites existing rows. */
import { DEFAULT_INSTRUCTIONS, DEFAULT_PRESETS, DEFAULT_SETTINGS } from '../../src/constants/defaults.js';

export async function seed(client) {
  const report = { instructions: 0, presets: 0, settings: 0 };
  for (const [tool, d] of Object.entries(DEFAULT_INSTRUCTIONS)) {
    const r = await client.query(
      `insert into public.ai_workspace_ai_instructions
         (tool_type, name, description, system_instruction, output_rules, formatting_preferences, additional_constraints)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (tool_type) do nothing`,
      [tool, d.name, d.description, d.systemInstruction, d.outputRules, d.formatting, d.constraints],
    );
    report.instructions += r.rowCount ?? r.affectedRows ?? 0;
  }
  for (const p of DEFAULT_PRESETS) {
    const r = await client.query(
      `insert into public.ai_workspace_image_presets
         (seed_key, name, description, width_px, height_px, background_instructions, layout_instructions, font_instructions,
          brand_colour_instructions, logo_placement_instructions, safe_area_instructions, is_starter, is_custom)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (seed_key) do nothing`,
      [p.seedKey, p.name, p.description, p.width, p.height, p.background, p.layout, p.typography, p.brandColors, p.logoPlacement, p.safeArea, p.isStarter, !!p.isCustom],
    );
    report.presets += r.rowCount ?? r.affectedRows ?? 0;
  }
  const s = await client.query(
    `insert into public.ai_workspace_settings
       (id, workspace_name, general_writing_preferences, default_tone, default_spelling_convention, date_format, default_file_view, default_image_preset_id)
     values (1, $1, $2, $3, $4, $5, $6, (select id from public.ai_workspace_image_presets where seed_key = $7))
     on conflict (id) do nothing`,
    [DEFAULT_SETTINGS.workspaceName, DEFAULT_SETTINGS.generalWritingPreferences, DEFAULT_SETTINGS.defaultTone, DEFAULT_SETTINGS.defaultSpelling, DEFAULT_SETTINGS.dateFormat, DEFAULT_SETTINGS.defaultFileView, DEFAULT_SETTINGS.defaultPresetSeedKey],
  );
  report.settings += s.rowCount ?? s.affectedRows ?? 0;
  return report;
}
