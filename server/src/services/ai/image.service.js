import { toFile } from 'openai';
import { getOpenAI } from '../../config/openai.js';
import { AppError } from '../../utils/errors.js';
import { chooseGenerationSize, imageInfo, postProcess, toPng } from './imageProcessing.js';

/**
 * Image generation through the OpenAI Images API, followed by exact-size
 * post-processing. Verified against openai@7 types (resources/images.d.ts):
 *   images.generate({ model, prompt, n, size, quality, output_format }) → { data: [{ b64_json }] }
 *   images.edit({ model, image: Uploadable[], prompt, n, size, quality, output_format }) → { data: [{ b64_json }] }
 * `toFile` (exported by 'openai') wraps buffers as uploadables.
 */

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function decodeImages(response, expected) {
  const data = Array.isArray(response?.data) ? response.data : [];
  const buffers = data.map((d) => (d?.b64_json ? Buffer.from(d.b64_json, 'base64') : null)).filter((b) => b?.length);
  if (!buffers.length) throw new AppError('AI_EMPTY_RESPONSE', 'The AI service did not return an image. Please retry.', 502);
  return buffers.slice(0, expected);
}

/**
 * Calls the provider and returns raw generated images (not yet resized).
 * @param {{ model:string, prompt:string, count:number, width:number, height:number, quality?:string, references?: Array<{buffer:Buffer, mimeType:string, name:string}> }} p
 */
export async function requestImages({ model, prompt, count, width, height, quality, references = [] }) {
  const client = getOpenAI();
  const size = chooseGenerationSize(model, width, height);
  const common = { model, prompt, n: count, size: size.sizeParam, output_format: 'png' };
  if (quality) common.quality = quality;

  let response;
  if (references.length) {
    const image = await Promise.all(
      references.map((r, i) => toFile(r.buffer, `reference-${i + 1}.${EXT[r.mimeType] || 'png'}`, { type: r.mimeType || 'image/png' })),
    );
    response = await client.images.edit({ ...common, image });
  } else {
    response = await client.images.generate(common);
  }
  const buffers = decodeImages(response, count);
  const u = response?.usage || {};
  return {
    buffers,
    size,
    providerRequestId: response?._request_id || null,
    usage: { inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null, totalTokens: u.total_tokens ?? null },
  };
}

/**
 * Turns one generated image into { finalImage, originalImage, imageMeta }
 * ready for output.service. Final pixels are verified to be exactly width × height.
 */
export async function processGeneratedImage(buffer, { width, height, strategy, background, logo, logoPlacement, model, presetId, prompt, size }) {
  const info = await imageInfo(buffer);
  const original = await toPng(buffer);
  const final = await postProcess(buffer, { width, height, strategy, background, logo, logoPlacement });
  return {
    finalImage: { buffer: final.buffer, mimeType: final.mimeType, width: final.width, height: final.height },
    originalImage: { buffer: original.buffer, mimeType: original.mimeType, width: original.width, height: original.height },
    imageMeta: {
      requestedWidth: width,
      requestedHeight: height,
      actualWidth: final.width,
      actualHeight: final.height,
      generatedWidth: info.width,
      generatedHeight: info.height,
      resizeStrategy: final.strategy,
      model,
      presetId: presetId || null,
      prompt: String(prompt || '').slice(0, 4000),
      requestedGenerationSize: size?.sizeParam,
      aspectClamped: !!size?.aspectClamped,
      logoApplied: !!logo,
    },
  };
}
