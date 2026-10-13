#!/usr/bin/env node
/**
 * Live OpenAI connectivity check (npm run ai:check). Makes ONE short text call
 * and, with --image, ONE low-quality image call, through the same service code
 * the API uses. Prints only status, model and dimensions — never keys or content.
 * This incurs a small OpenAI charge.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { generateText } from '../src/services/ai/text.service.js';
import { requestImages, processGeneratedImage } from '../src/services/ai/image.service.js';
import { resolveImageModel, resolveTextModel } from '../src/constants/models.js';

const withImage = process.argv.includes('--image');
try {
  const textModel = resolveTextModel();
  const t = await generateText({
    model: textModel,
    instructions: 'Reply with exactly one short sentence.',
    input: 'Say hello to the StudioFlow team.',
    maxTokens: 200,
  });
  console.log(`✔ text: model=${t.model} chars=${t.text.length} tokens=${t.usage.totalTokens ?? '?'}`);

  if (withImage) {
    const imageModel = resolveImageModel();
    const width = 1080;
    const height = 1350;
    const r = await requestImages({ model: imageModel, prompt: 'A calm abstract gradient in navy and aqua, no text.', count: 1, width, height, quality: 'low' });
    const p = await processGeneratedImage(r.buffers[0], { width, height, strategy: 'cover', background: '#FFFFFF', model: imageModel, size: r.size });
    const ok = p.finalImage.width === width && p.finalImage.height === height;
    console.log(`${ok ? '✔' : '✖'} image: model=${imageModel} requested=${width}x${height} generated=${p.imageMeta.generatedWidth}x${p.imageMeta.generatedHeight} (size param ${r.size.sizeParam}) final=${p.finalImage.width}x${p.finalImage.height}`);
    if (!ok) process.exitCode = 1;
  }
  console.log(`Configured: text=${env.OPENAI_TEXT_MODEL}, image=${env.OPENAI_IMAGE_MODEL}`);
} catch (err) {
  console.error(`✖ OpenAI check failed: ${err?.status ? `HTTP ${err.status} ` : ''}${err?.code || ''} ${String(err?.message || err).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 300)}`);
  process.exitCode = 1;
}
