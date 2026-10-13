import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  chooseGenerationSize,
  logoGravity,
  parseHexColour,
  postProcess,
  validateDimensions,
} from '../../src/services/ai/imageProcessing.js';

const solid = (width, height, background = { r: 200, g: 30, b: 30, alpha: 1 }) =>
  sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();

describe('chooseGenerationSize', () => {
  it('gpt-image-2: keeps the requested aspect, multiples of 16, within limits', () => {
    const s = chooseGenerationSize('gpt-image-2', 1080, 1350);
    expect(s.width % 16).toBe(0);
    expect(s.height % 16).toBe(0);
    expect(Math.abs(s.width / s.height - 1080 / 1350)).toBeLessThan(0.02);
    expect(s.aspectClamped).toBe(false);
    expect(s.sizeParam).toBe(`${s.width}x${s.height}`);
  });

  it('gpt-image-2: scales oversized requests into edge and pixel limits', () => {
    const s = chooseGenerationSize('gpt-image-2', 4096, 4096);
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(3840);
    expect(s.width * s.height).toBeLessThanOrEqual(3840 * 2160);
    expect(s.width % 16).toBe(0);
  });

  it('gpt-image-2: clamps extreme aspect ratios to 3:1 / 1:3', () => {
    const wide = chooseGenerationSize('gpt-image-2', 4000, 400);
    expect(wide.aspectClamped).toBe(true);
    expect(wide.width / wide.height).toBeLessThanOrEqual(3);
    expect(wide.width / wide.height).toBeGreaterThan(2.8);
    const tall = chooseGenerationSize('gpt-image-2', 300, 3000);
    expect(tall.aspectClamped).toBe(true);
    expect(tall.width / tall.height).toBeGreaterThanOrEqual(1 / 3);
  });

  it('gpt-image-2: small requests are generated larger and downscaled later', () => {
    const s = chooseGenerationSize('gpt-image-2', 64, 64);
    expect(s.width).toBeGreaterThan(64);
    expect(s.width).toBe(s.height);
  });

  it('other models: picks the standard size with the closest aspect', () => {
    expect(chooseGenerationSize('gpt-image-1', 1200, 628).sizeParam).toBe('1536x1024');
    expect(chooseGenerationSize('gpt-image-1', 1080, 1920).sizeParam).toBe('1024x1536');
    expect(chooseGenerationSize('gpt-image-1.5', 1080, 1080).sizeParam).toBe('1024x1024');
  });

  it('rejects unknown models', () => {
    expect(() => chooseGenerationSize('dall-e-9', 100, 100)).toThrow();
  });
});

describe('validateDimensions', () => {
  it('accepts integers in range and rejects others', () => {
    expect(() => validateDimensions(1080, 1350)).not.toThrow();
    for (const [w, h] of [[10, 10], [20000, 1000], [1080.5, 1000], [undefined, 100], [64, 4097]]) {
      expect(() => validateDimensions(w, h)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });
});

describe('postProcess', () => {
  it.each(['cover', 'contain', 'fill'])('%s produces the exact requested size as PNG', async (strategy) => {
    const src = await solid(1024, 1536);
    const out = await postProcess(src, { width: 1080, height: 1350, strategy, background: '#00ff00' });
    const meta = await sharp(out.buffer).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1350, 'png']);
    expect(out.strategy).toBe(strategy);
  });

  it('contain pads with the client background colour', async () => {
    const src = await solid(1000, 1000);
    const out = await postProcess(src, { width: 2000, height: 1000, strategy: 'contain', background: '#00FF00' });
    const { data } = await sharp(out.buffer).extract({ left: 5, top: 500, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([0, 255, 0]);
  });

  it('composites a logo no wider than 15% of the width at the requested corner', async () => {
    const src = await solid(1000, 1000, { r: 255, g: 255, b: 255, alpha: 1 });
    const logo = await solid(800, 400, { r: 0, g: 0, b: 255, alpha: 1 });
    const out = await postProcess(src, { width: 1000, height: 1000, strategy: 'cover', logo, logoPlacement: 'Logo bottom-right corner' });
    const px = async (x, y) => {
      const { data } = await sharp(out.buffer).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      return [data[0], data[1], data[2]];
    };
    expect(await px(950, 950)).toEqual([0, 0, 255]); // inside the logo (bottom-right)
    expect(await px(50, 50)).toEqual([255, 255, 255]); // top-left untouched
    expect(await px(1000 - 40 - 151, 950)).toEqual([255, 255, 255]); // logo ≤ 150px wide
  });
});

describe('helpers', () => {
  it('parses hex colours and logo placement text', () => {
    expect(parseHexColour('#abc')).toMatchObject({ r: 170, g: 187, b: 204 });
    expect(parseHexColour('nope')).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(logoGravity('Top-right, small')).toBe('northeast');
    expect(logoGravity('bottom left')).toBe('southwest');
    expect(logoGravity('')).toBe('northwest');
  });
});
