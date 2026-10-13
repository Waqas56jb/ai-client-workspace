import { getOpenAI } from '../../config/openai.js';
import { AppError } from '../../utils/errors.js';
import { cleanModelText } from './parsers.js';

export const DEFAULT_MAX_OUTPUT_TOKENS = 1500;
export const MAX_OUTPUT_TOKENS_CAP = 8000;

/** max_output_tokens from the instruction's model_configuration (bounded). */
export function maxOutputTokens(instruction) {
  const n = Number(instruction?.modelConfiguration?.max_output_tokens);
  return Number.isInteger(n) && n >= 16 ? Math.min(n, MAX_OUTPUT_TOKENS_CAP) : DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Calls the Responses API (`client.responses.create`) and returns the text.
 * Verified against openai@7 types: ResponseCreateParams { model, instructions,
 * input, max_output_tokens, store } → Response { id, output_text, usage, model }.
 */
export async function generateText({ model, instructions, input, maxTokens }) {
  const client = getOpenAI();
  const response = await client.responses.create({
    model,
    instructions,
    input,
    max_output_tokens: maxTokens,
    store: false,
  });
  // A response cut off by max_output_tokens (or a content filter) is not a usable draft.
  if (response?.status === 'incomplete') {
    throw new AppError('AI_INCOMPLETE', 'The AI response was cut off before it finished. Retry, or ask for a shorter output.', 502);
  }
  const text = cleanModelText(response?.output_text || '');
  if (!text) {
    throw new AppError('AI_EMPTY_RESPONSE', 'The AI service returned an empty response. Please retry.', 502);
  }
  const u = response.usage || {};
  return {
    text,
    model: response.model || model,
    providerResponseId: response.id || null,
    providerRequestId: response._request_id || null,
    status: response.status || null,
    usage: { inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null, totalTokens: u.total_tokens ?? null },
  };
}
