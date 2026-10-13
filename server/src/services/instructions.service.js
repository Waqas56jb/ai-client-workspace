import crypto from 'node:crypto';
import { getDatabase } from '../config/db.js';
import { ACTIVITY } from '../constants/domain.js';
import { DEFAULT_INSTRUCTIONS, TOOL_DISPLAY_ORDER } from '../constants/defaults.js';
import { IMAGE_MODELS, TEXT_MODELS } from '../constants/models.js';
import { badRequest } from '../utils/errors.js';
import { logActivity } from '../repositories/activity.repository.js';
import * as repo from '../repositories/instructions.repository.js';

const db = () => getDatabase();
const IMAGE_TOOL = 'image_creation';

/**
 * Tool-specific model configuration rules (shape already validated by Zod):
 * text tools → model ∈ TEXT_MODELS, no quality; image tool → model ∈ IMAGE_MODELS.
 * @param {string} dbToolType
 * @param {object} mc
 */
export function assertModelConfiguration(dbToolType, mc = {}) {
  const issues = [];
  const isImage = dbToolType === IMAGE_TOOL;
  if (mc.model !== undefined) {
    const allowed = isImage ? Object.keys(IMAGE_MODELS) : TEXT_MODELS;
    if (!allowed.includes(mc.model)) issues.push({ path: 'modelConfiguration.model', message: `Model must be one of: ${allowed.join(', ')}.` });
  }
  if (mc.quality !== undefined && !isImage) issues.push({ path: 'modelConfiguration.quality', message: 'Quality applies to the image tool only.' });
  if (issues.length) throw badRequest('The model configuration is not allowed.', issues.map((i) => ({ location: 'body', ...i })));
}

/** Current values in API shape: saved row or default template. */
function currentValues(row, dbToolType) {
  return row ? repo.toInstructionDto(row) : repo.defaultInstructionDto(dbToolType);
}

async function save(tx, userId, dbToolType, values, description) {
  const row = await repo.upsertInstruction(tx, dbToolType, values, userId);
  await logActivity(tx, {
    userId,
    type: ACTIVITY.INSTRUCTIONS_UPDATED,
    resourceType: 'instruction',
    resourceId: repo.toInstructionDto(row).toolId,
    description: `${description} (v${row.version})`,
    metadata: { toolType: dbToolType, version: row.version },
  });
  return repo.toInstructionDto(row);
}

/**
 * All four tools in display order; unsaved tools return their default template
 * (`isDefault: true`) without writing anything.
 * @param {string} userId
 */
export function list(userId) {
  return db().withUser(userId, async (tx) => {
    const byTool = new Map((await repo.listInstructionRows(tx)).map((r) => [r.tool_type, r]));
    return TOOL_DISPLAY_ORDER.map((t) => currentValues(byTool.get(t), t));
  });
}

/**
 * @param {string} userId
 * @param {string} dbToolType
 */
export function get(userId, dbToolType) {
  return db().withUser(userId, async (tx) => currentValues(await repo.getInstructionRow(tx, dbToolType), dbToolType));
}

/**
 * Partial update (insert when missing); version + 1. Examples without ids get one.
 * @param {string} userId
 * @param {string} dbToolType
 * @param {object} body validated patch
 */
export function update(userId, dbToolType, body) {
  if (body.modelConfiguration) assertModelConfiguration(dbToolType, body.modelConfiguration);
  return db().withUser(userId, async (tx) => {
    const current = currentValues(await repo.getInstructionRow(tx, dbToolType), dbToolType);
    const next = { ...current };
    for (const [k, v] of Object.entries(body)) if (v !== undefined) next[k] = v;
    if (body.examples) next.examples = body.examples.map((e) => ({ id: e.id || `ex_${crypto.randomUUID().slice(0, 12)}`, input: e.input, output: e.output }));
    return save(tx, userId, dbToolType, next, `Updated ${next.name} instructions`);
  });
}

/**
 * Restores the default template from constants/defaults.js (examples and model
 * configuration cleared, active), saved as a new version.
 * @param {string} userId
 * @param {string} dbToolType
 */
export function reset(userId, dbToolType) {
  const d = DEFAULT_INSTRUCTIONS[dbToolType];
  return db().withUser(userId, (tx) =>
    save(tx, userId, dbToolType, { ...d, examples: [], active: true, modelConfiguration: {} }, `Reset ${d.name} instructions to defaults`),
  );
}
