import { env } from '../config/env.js';

/**
 * Server-side model allowlists. Saved AI-instruction `model_configuration`
 * values and environment defaults are validated against these lists; the
 * frontend can never select an arbitrary model.
 *
 * Capabilities verified against the installed `openai` SDK type definitions
 * (resources/images.d.ts): the gpt-image-2 family accepts arbitrary WIDTHxHEIGHT
 * (multiples of 16, aspect 1:3–3:1, max 3840x2160); other GPT image models
 * accept only 1024x1024, 1536x1024 and 1024x1536.
 */
export const TEXT_MODELS = ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-nano', 'gpt-5.5', 'gpt-5-mini', 'gpt-5', 'gpt-4.1', 'gpt-4.1-mini'];

export const IMAGE_MODELS = {
  'gpt-image-2': { arbitrarySize: true, maxEdge: 3840, maxPixels: 3840 * 2160, multiple: 16, edit: true },
  'gpt-image-1.5': { arbitrarySize: false, edit: true },
  'gpt-image-1': { arbitrarySize: false, edit: true },
  'gpt-image-1-mini': { arbitrarySize: false, edit: true },
};

export const STANDARD_IMAGE_SIZES = [
  { width: 1024, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1024, height: 1536 },
];

export const IMAGE_QUALITIES = ['low', 'medium', 'high', 'auto'];

export function resolveTextModel(requested) {
  const model = requested || env.OPENAI_TEXT_MODEL;
  return TEXT_MODELS.includes(model) ? model : null;
}

export function resolveImageModel(requested, { edit = false } = {}) {
  const model = requested || (edit ? env.OPENAI_IMAGE_EDIT_MODEL : env.OPENAI_IMAGE_MODEL);
  return IMAGE_MODELS[model] ? model : null;
}
