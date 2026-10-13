import { DEFAULT_INSTRUCTIONS } from '../constants/defaults.js';
import { iso, toolId, userColumns, userSummary } from '../utils/mappers.js';

/**
 * AI instructions repository. One row per tool (unique tool_type).
 *
 * `model_configuration` is stored with snake_case keys
 * `{ model?, max_output_tokens?, quality? }` (already validated against the
 * allowlists in constants/models.js) and exposed in the DTO as
 * `modelConfiguration: { model?, maxOutputTokens?, quality? }`.
 */

const I = 'public.ai_workspace_ai_instructions';
const U = 'public.ai_workspace_users';
const SELECT = `i.*, ${userColumns('u', 'uu_')}`;
const FROM = `${I} i left join ${U} u on u.id = i.updated_by`;

/** DB model_configuration → API modelConfiguration. */
export function modelConfigToApi(mc = {}) {
  const out = {};
  if (mc.model !== undefined) out.model = mc.model;
  if (mc.max_output_tokens !== undefined) out.maxOutputTokens = mc.max_output_tokens;
  if (mc.quality !== undefined) out.quality = mc.quality;
  return out;
}

/** API modelConfiguration → DB model_configuration. */
export function modelConfigToDb(mc = {}) {
  const out = {};
  if (mc.model !== undefined) out.model = mc.model;
  if (mc.maxOutputTokens !== undefined) out.max_output_tokens = mc.maxOutputTokens;
  if (mc.quality !== undefined) out.quality = mc.quality;
  return out;
}

/**
 * Row → Instruction DTO.
 * @param {object} row
 */
export function toInstructionDto(row) {
  return {
    id: row.id,
    toolId: toolId(row.tool_type),
    name: row.name,
    description: row.description,
    systemInstruction: row.system_instruction,
    outputRules: row.output_rules,
    formatting: row.formatting_preferences,
    constraints: row.additional_constraints,
    examples: Array.isArray(row.examples) ? row.examples : [],
    active: row.is_active,
    version: row.version,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by,
    updatedByUser: userSummary(row, 'uu_'),
    modelConfiguration: modelConfigToApi(row.model_configuration || {}),
    isDefault: false,
  };
}

/**
 * Default template (constants/defaults.js) as a DTO, used when no row exists yet.
 * Nothing is written.
 * @param {string} dbToolType
 */
export function defaultInstructionDto(dbToolType) {
  const d = DEFAULT_INSTRUCTIONS[dbToolType];
  return {
    id: null,
    toolId: toolId(dbToolType),
    name: d.name,
    description: d.description,
    systemInstruction: d.systemInstruction,
    outputRules: d.outputRules,
    formatting: d.formatting,
    constraints: d.constraints,
    examples: [],
    active: true,
    version: 0,
    updatedAt: null,
    updatedBy: null,
    updatedByUser: null,
    modelConfiguration: {},
    isDefault: true,
  };
}

/**
 * Raw instruction row for a tool (DB value, e.g. 'writing_editing') or null when
 * the tool has never been saved — callers should then fall back to
 * DEFAULT_INSTRUCTIONS[dbToolType]. Check `is_active` before applying it.
 * `model_configuration` uses keys { model, max_output_tokens, quality }.
 * @param {object} tx
 * @param {string} dbToolType
 * @returns {Promise<object|null>}
 */
export async function getInstructionRow(tx, dbToolType) {
  const { rows } = await tx.query(`select ${SELECT} from ${FROM} where i.tool_type = $1`, [dbToolType]);
  return rows[0] || null;
}

/** All saved instruction rows. */
export async function listInstructionRows(tx) {
  const { rows } = await tx.query(`select ${SELECT} from ${FROM}`);
  return rows;
}

/**
 * Insert-or-update the full instruction set for a tool; bumps version on update
 * (version 1 on first insert). Row-locks via ON CONFLICT so concurrent saves get
 * distinct versions.
 * @param {object} tx
 * @param {string} dbToolType
 * @param {{ name, description, systemInstruction, outputRules, formatting, constraints, examples, active, modelConfiguration }} v API-shaped values
 * @param {string} userId
 */
export async function upsertInstruction(tx, dbToolType, v, userId) {
  await tx.query(
    `insert into ${I} as i (tool_type, name, description, system_instruction, output_rules, formatting_preferences,
                            additional_constraints, examples, model_configuration, is_active, version, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, 1, $11, $11)
     on conflict (tool_type) do update set
       name = excluded.name, description = excluded.description, system_instruction = excluded.system_instruction,
       output_rules = excluded.output_rules, formatting_preferences = excluded.formatting_preferences,
       additional_constraints = excluded.additional_constraints, examples = excluded.examples,
       model_configuration = excluded.model_configuration, is_active = excluded.is_active,
       version = i.version + 1, updated_by = excluded.updated_by`,
    [
      dbToolType,
      v.name,
      v.description,
      v.systemInstruction,
      v.outputRules,
      v.formatting,
      v.constraints,
      JSON.stringify(v.examples),
      JSON.stringify(modelConfigToDb(v.modelConfiguration)),
      v.active,
      userId,
    ],
  );
  return getInstructionRow(tx, dbToolType);
}
