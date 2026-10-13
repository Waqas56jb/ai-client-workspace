import { createId, nowIso } from './utils';

/**
 * Prepares the structured AI request for a single generation.
 *
 * This is deliberately UI-independent so the future Node.js backend can accept
 * (or re-create) exactly this shape and forward it to the model provider. The
 * frontend never calls a model directly and never holds API keys.
 *
 * Isolation rule: only the SELECTED client's profile is included. No other
 * client's branding or business information can enter the request.
 */

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k]).map((k) => [k, obj[k]]));

const BRAND_KEYS = ['primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'fontFamily', 'headingFont', 'bodyFont', 'guidelines'];
const BUSINESS_KEYS = ['businessName', 'address', 'phone', 'email', 'website'];
const WRITING_KEYS = ['tone', 'formality', 'spelling', 'useWords', 'avoidWords', 'formatting', 'writingInstructions'];
const TERMS_KEYS = ['warranty', 'disclaimers', 'terms', 'legal'];
const ADDITIONAL_KEYS = ['referenceNotes', 'productInfo', 'targetAudience', 'imageStyle', 'otherInstructions'];

/** Which parts of the client profile each tool receives. */
const RELEVANCE = {
  writing: { brand: false, business: true, writing: true, terms: TERMS_KEYS, additional: ['referenceNotes', 'productInfo', 'targetAudience', 'otherInstructions'] },
  image: { brand: true, business: ['businessName', 'website'], writing: false, terms: false, additional: ['imageStyle', 'targetAudience', 'referenceNotes', 'otherInstructions'] },
  advertising: { brand: false, business: true, writing: true, terms: ['disclaimers', 'terms', 'legal'], additional: ['productInfo', 'targetAudience', 'referenceNotes', 'otherInstructions'] },
  vehicle: { brand: false, business: true, writing: true, terms: ['warranty', 'disclaimers', 'terms', 'legal'], additional: ['referenceNotes', 'otherInstructions'] },
};

export function buildClientContext(client, toolId) {
  if (!client) return null;
  const rel = RELEVANCE[toolId] || RELEVANCE.writing;
  const b = client.brand || {};
  const section = (flag, keys) => (flag ? pick(b, Array.isArray(flag) ? flag : keys) : undefined);
  return {
    id: client.id,
    name: client.name,
    industry: client.industry,
    description: client.description,
    brand: section(rel.brand, BRAND_KEYS),
    business: section(rel.business, BUSINESS_KEYS),
    writingPreferences: section(rel.writing, WRITING_KEYS),
    approvedTerms: section(rel.terms, TERMS_KEYS),
    additional: section(rel.additional, ADDITIONAL_KEYS),
  };
}

/**
 * @param {object} p
 * @param {object} p.client   full client record (selected client only)
 * @param {object} p.job
 * @param {object} p.task
 * @param {string} p.toolId   'writing' | 'image' | 'advertising' | 'vehicle'
 * @param {object} p.instructions  tool configuration from AI Instructions
 * @param {string} p.prompt
 * @param {object} [p.options]     tool-specific options (format, tone, dimensions…)
 * @param {Array}  [p.history]     prior messages in the conversation
 * @param {object} [p.preset]      selected image preset
 * @param {Array}  [p.attachments] reference files
 * @param {object} [p.preferences] workspace preferences
 */
export function buildAiRequest({ client, job, task, toolId, instructions, prompt, options = {}, history = [], preset = null, attachments = [], preferences = {} }) {
  if (task && client && task.clientId !== client.id) {
    throw new Error('Context mismatch: the task does not belong to the selected client.');
  }
  return {
    requestId: createId('req'),
    createdAt: nowIso(),
    mode: 'simulated',
    tool: { id: toolId, name: instructions?.name },
    instructions: instructions
      ? {
          version: instructions.version,
          systemInstruction: instructions.systemInstruction,
          outputRules: instructions.outputRules,
          formatting: instructions.formatting,
          constraints: instructions.constraints,
          examples: (instructions.examples || []).map(({ input, output }) => ({ input, output })),
        }
      : null,
    client: buildClientContext(client, toolId),
    job: job ? pick(job, ['id', 'title', 'description', 'notes', 'deadline']) : null,
    task: task ? pick(task, ['id', 'title', 'type', 'description', 'notes']) : null,
    workspaceDefaults: pick(preferences, ['writingPreferences', 'spelling', 'defaultTone']),
    prompt: prompt?.trim() || '',
    options,
    preset:
      toolId === 'image' && preset
        ? pick(preset, ['id', 'name', 'width', 'height', 'background', 'layout', 'typography', 'brandColors', 'logoPlacement', 'safeArea'])
        : undefined,
    output:
      toolId === 'image'
        ? {
            requestedWidth: Number(options.width) || preset?.width,
            requestedHeight: Number(options.height) || preset?.height,
            postProcess: 'resize-or-crop-to-exact-dimensions',
          }
        : undefined,
    attachments: attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind, mimeType: a.mimeType })),
    history: history
      .filter((m) => m.status !== 'error')
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content })),
  };
}
