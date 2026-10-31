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
export async function generateText({ model, instructions, input, maxTokens, raw = false, onDelta = null }) {
  const client = getOpenAI();
  const params = { model, instructions, input, max_output_tokens: maxTokens, store: false };
  // With onDelta the answer is streamed (stream: true) and every text piece is passed on as it arrives.
  const response = onDelta ? await streamed(client, params, onDelta) : await client.responses.create(params);
  // A response cut off by max_output_tokens (or a content filter) is not a usable draft.
  if (response?.status === 'incomplete') {
    throw new AppError('AI_INCOMPLETE', 'The AI response was cut off before it finished. Retry, or ask for a shorter output.', 502);
  }
  // Drafts lose a stray ``` wrapper; chat answers keep their markdown (a code block is the answer).
  const text = raw ? String(response?.output_text || '').trim() : cleanModelText(response?.output_text || '');
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

/**
 * Streams a response: forwards each output_text delta and returns a response-like
 * object ({ id, model, status, usage, output_text }) once it is complete.
 * Also accepts a non-streaming result (test fakes), so callers need no special case.
 */
async function streamed(client, params, onDelta) {
  const stream = await client.responses.create({ ...params, stream: true });
  if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
    if (stream?.output_text) onDelta(stream.output_text);
    return stream;
  }
  let text = '';
  let final = null;
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta' && event.delta) {
      text += event.delta;
      try {
        onDelta(event.delta);
      } catch {
        /* a viewer going away never stops the answer */
      }
    } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      final = event.response;
    } else if (event.type === 'response.failed' || event.type === 'error') {
      const err = new Error(event.response?.error?.message || event.message || 'The AI stream failed.');
      err.status = 502;
      throw err;
    }
  }
  return { ...(final || {}), status: final?.status || 'completed', output_text: text || final?.output_text || '' };
}
