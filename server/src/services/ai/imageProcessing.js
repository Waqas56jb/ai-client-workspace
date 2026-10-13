import sharp from 'sharp';
import { env } from '../../config/env.js';
import { IMAGE_MODELS, STANDARD_IMAGE_SIZES } from '../../constants/models.js';
import { AppError, badRequest } from '../../utils/errors.js';

/**
 * Image pipeline helpers (Sharp).
 *
 * 1. `chooseGenerationSize` picks the NATIVE size to request from the model:
 *    - arbitrary-size models (gpt-image-2): the requested size, aspect clamped to
 *      1:3–3:1, scaled into the model's edge/pixel limits, rounded to multiples of 16;
 *    - other GPT image models: the standard size with the closest aspect ratio.
 * 2. `postProcess` turns the generated pixels into EXACTLY the requested
 *    width × height with the preset's resize strategy, optionally composites the
 *    client's logo, outputs PNG and verifies the final dimensions.
 */

export const MIN_DIMENSION_PX = 64;
export const MIN_ASPECT = 1 / 3;
export const MAX_ASPECT = 3;
/**
 * Conservative lower bound on generated pixels for arbitrary-size models. Very
 * small requests (e.g. 64×64) are generated larger and downscaled, which both
 * stays inside provider minimums and gives better quality.
 */
export const MIN_GENERATION_PIXELS = 1024 * 640;
export const LOGO_MAX_WIDTH_RATIO = 0.15;
export const RESIZE_STRATEGIES = ['cover', 'contain', 'fill'];

/** Validates requested output dimensions (integers, 64…IMAGE_MAX_DIMENSION_PX). Throws 400. */
export function validateDimensions(width, height, max = env.IMAGE_MAX_DIMENSION_PX) {
  const bad = (n) => !Number.isInteger(n) || n < MIN_DIMENSION_PX || n > max;
  if (bad(width) || bad(height)) {
    throw badRequest(`Width and height must be whole numbers between ${MIN_DIMENSION_PX} and ${max}px.`, [
      { location: 'body', path: 'options.width', message: `Must be an integer between ${MIN_DIMENSION_PX} and ${max}.` },
    ]);
  }
}

const round16 = (n) => Math.max(16, Math.round(n / 16) * 16);
const floor16 = (n) => Math.max(16, Math.floor(n / 16) * 16);

/**
 * @returns {{ width:number, height:number, aspectClamped:boolean, sizeParam:string }}
 */
export function chooseGenerationSize(model, width, height) {
  const caps = IMAGE_MODELS[model];
  if (!caps) throw new AppError('AI_CONFIG_ERROR', 'The configured image model is not supported.', 500);
  const ratio = width / height;

  if (!caps.arbitrarySize) {
    let best = STANDARD_IMAGE_SIZES[0];
    let bestDiff = Infinity;
    for (const s of STANDARD_IMAGE_SIZES) {
      const diff = Math.abs(Math.log(ratio) - Math.log(s.width / s.height));
      if (diff < bestDiff) {
        best = s;
        bestDiff = diff;
      }
    }
    return { width: best.width, height: best.height, aspectClamped: false, sizeParam: `${best.width}x${best.height}` };
  }

  const clampedRatio = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, ratio));
  const aspectClamped = clampedRatio !== ratio;
  const area = width * height;
  let w = aspectClamped ? Math.sqrt(area * clampedRatio) : width;
  let h = aspectClamped ? Math.sqrt(area / clampedRatio) : height;

  const maxEdge = caps.maxEdge || 3840;
  const maxPixels = caps.maxPixels || 3840 * 2160;
  let scale = Math.min(1, maxEdge / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  if (w * h * scale * scale < MIN_GENERATION_PIXELS) {
    scale = Math.min(Math.sqrt(MIN_GENERATION_PIXELS / (w * h)), maxEdge / Math.max(w, h));
  }
  w = round16(w * scale);
  h = round16(h * scale);

  // Rounding can push a size just past a limit — step down in multiples of 16.
  const step = 16;
  for (let i = 0; i < 400; i += 1) {
    const over = w > maxEdge || h > maxEdge || w * h > maxPixels;
    const tooWide = w / h > MAX_ASPECT;
    const tooTall = w / h < MIN_ASPECT;
    if (!over && !tooWide && !tooTall) break;
    if (tooWide) w = floor16(h * MAX_ASPECT);
    else if (tooTall) h = floor16(w / MIN_ASPECT);
    else if (w >= h) w -= step;
    else h -= step;
  }
  // Rounding can also leave a small request just under the minimum pixel count —
  // grow in multiples of 16, keeping the ratio closest to the requested one.
  const target = clampedRatio;
  for (let i = 0; i < 400 && w * h < MIN_GENERATION_PIXELS; i += 1) {
    const candidates = [
      { w: w + step, h },
      { w, h: h + step },
    ].filter((c) => c.w <= maxEdge && c.h <= maxEdge && c.w * c.h <= maxPixels && c.w / c.h <= MAX_ASPECT && c.w / c.h >= MIN_ASPECT);
    if (!candidates.length) break;
    candidates.sort((a, b) => Math.abs(Math.log(a.w / a.h / target)) - Math.abs(Math.log(b.w / b.h / target)));
    ({ w, h } = candidates[0]);
  }
  return { width: w, height: h, aspectClamped, sizeParam: `${w}x${h}` };
}

/** '#abc' | '#aabbcc' → { r, g, b, alpha } (white fallback). */
export function parseHexColour(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 255, g: 255, b: 255, alpha: 1 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), alpha: 1 };
}

/** Logo placement from free-text preset guidance. Defaults to top-left. */
export function logoGravity(text = '') {
  const t = String(text).toLowerCase();
  if (/top[\s-]?right/.test(t)) return 'northeast';
  if (/bottom[\s-]?left/.test(t)) return 'southwest';
  if (/bottom[\s-]?right/.test(t)) return 'southeast';
  if (/top[\s-]?left/.test(t)) return 'northwest';
  return 'northwest';
}

async function compositeLogo(base, { width, height, logo, placement }) {
  const maxW = Math.max(1, Math.floor(width * LOGO_MAX_WIDTH_RATIO));
  const maxH = Math.max(1, Math.floor(height * LOGO_MAX_WIDTH_RATIO));
  const logoBuf = await sharp(logo).resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const meta = await sharp(logoBuf).metadata();
  const margin = Math.round(Math.min(width, height) * 0.04);
  const gravity = logoGravity(placement);
  const left = gravity.endsWith('west') ? margin : Math.max(0, width - meta.width - margin);
  const top = gravity.startsWith('north') ? margin : Math.max(0, height - meta.height - margin);
  return sharp(base).composite([{ input: logoBuf, left, top }]).png().toBuffer();
}

/**
 * Resizes/crops/pads `buffer` to exactly width × height and returns PNG bytes.
 * @param {Buffer} buffer generated image
 * @param {{ width:number, height:number, strategy?:'cover'|'contain'|'fill', background?:string, logo?:Buffer|null, logoPlacement?:string }} opts
 */
export async function postProcess(buffer, { width, height, strategy = 'cover', background = '#FFFFFF', logo = null, logoPlacement = '' }) {
  const fit = RESIZE_STRATEGIES.includes(strategy) ? strategy : 'cover';
  const resizeOpts = { width, height, fit };
  if (fit === 'cover') resizeOpts.position = sharp.strategy.attention;
  if (fit === 'contain') resizeOpts.background = parseHexColour(background);

  let out = await sharp(buffer).resize(resizeOpts).png().toBuffer();
  if (logo) out = await compositeLogo(out, { width, height, logo, placement: logoPlacement });

  const meta = await sharp(out).metadata();
  if (meta.width !== width || meta.height !== height || meta.format !== 'png') {
    throw new AppError('IMAGE_PROCESSING_FAILED', 'The generated image could not be produced at the requested size.', 500);
  }
  return { buffer: out, mimeType: 'image/png', width: meta.width, height: meta.height, strategy: fit };
}

/** Reads dimensions of a generated image (also validates it is a real image). */
export async function imageInfo(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) throw new Error('no dimensions');
    return { width: meta.width, height: meta.height, format: meta.format };
  } catch {
    throw new AppError('AI_INVALID_RESPONSE', 'The AI service returned an image that could not be read.', 502);
  }
}

/** Normalises any supported image to PNG (keeps the original pixels). */
export async function toPng(buffer) {
  const out = await sharp(buffer).png().toBuffer();
  const meta = await sharp(out).metadata();
  return { buffer: out, mimeType: 'image/png', width: meta.width, height: meta.height };
}
