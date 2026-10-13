import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { detectFile, extensionOf, isUtf8Text, normaliseMime } from '../../src/utils/fileDetection.js';

const png = () => sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } }).png().toBuffer();
const jpeg = () => sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } }).jpeg().toBuffer();

async function expect415(input) {
  await expect(detectFile(input)).rejects.toMatchObject({ status: 415, code: 'UNSUPPORTED_FILE_TYPE' });
}

describe('fileDetection', () => {
  it('helpers normalise names and MIME types', () => {
    expect(extensionOf('Report.Final.PDF')).toBe('pdf');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
    expect(normaliseMime('Text/Plain; charset=UTF-8')).toBe('text/plain');
    expect(normaliseMime('image/jpg')).toBe('image/jpeg');
    expect(isUtf8Text(Buffer.from('héllo'))).toBe(true);
    expect(isUtf8Text(Buffer.from([0x68, 0x00, 0x69]))).toBe(false);
    expect(isUtf8Text(Buffer.from([0xff, 0xfe, 0xfd]))).toBe(false);
  });

  it('accepts a real PNG and JPEG', async () => {
    await expect(detectFile({ buffer: await png(), declaredMime: 'image/png', originalName: 'a.png' })).resolves.toEqual({
      mimeType: 'image/png',
      category: 'image',
      extension: 'png',
    });
    await expect(detectFile({ buffer: await jpeg(), declaredMime: 'image/jpeg', originalName: 'a.JPG' })).resolves.toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('rejects spoofed content, mismatched types and wrong extensions', async () => {
    await expect415({ buffer: Buffer.from('just some text'), declaredMime: 'image/png', originalName: 'x.png' });
    await expect415({ buffer: await png(), declaredMime: 'image/jpeg', originalName: 'x.jpg' });
    await expect415({ buffer: await png(), declaredMime: 'image/png', originalName: 'x.jpg' });
    await expect415({ buffer: await png(), declaredMime: 'text/plain', originalName: 'x.txt' });
  });

  it('rejects SVG and unknown types', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect415({ buffer: svg, declaredMime: 'image/svg+xml', originalName: 'x.svg' });
    await expect415({ buffer: svg, declaredMime: 'text/plain', originalName: 'x.svg' });
    await expect415({ buffer: Buffer.from('MZ....'), declaredMime: 'application/x-msdownload', originalName: 'x.exe' });
  });

  it('validates textual types as UTF-8 without NUL bytes', async () => {
    await expect(detectFile({ buffer: Buffer.from('# Title\n\nBody'), declaredMime: 'text/markdown', originalName: 'notes.md' })).resolves.toMatchObject({
      mimeType: 'text/markdown',
      category: 'text',
    });
    await expect415({ buffer: Buffer.from([0x61, 0x00, 0x62]), declaredMime: 'text/plain', originalName: 'x.txt' });
    await expect415({ buffer: Buffer.from([0xc3, 0x28]), declaredMime: 'text/plain', originalName: 'x.txt' });
  });

  it('treats Windows-declared CSV as text/csv after content checks', async () => {
    await expect(detectFile({ buffer: Buffer.from('a,b\n1,2\n'), declaredMime: 'application/vnd.ms-excel', originalName: 'data.csv' })).resolves.toMatchObject({
      mimeType: 'text/csv',
      category: 'document',
    });
  });

  it('accepts PDFs by content', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    await expect(detectFile({ buffer: pdf, declaredMime: 'application/pdf', originalName: 'doc.pdf' })).resolves.toMatchObject({ mimeType: 'application/pdf' });
    await expect415({ buffer: Buffer.from('not a pdf'), declaredMime: 'application/pdf', originalName: 'doc.pdf' });
  });

  it('rejects empty files with 400', async () => {
    await expect(detectFile({ buffer: Buffer.alloc(0), declaredMime: 'text/plain', originalName: 'x.txt' })).rejects.toMatchObject({ status: 400 });
  });

  it('rejects truncated or corrupt images with 400 (QA regression)', async () => {
    const full = await sharp({ create: { width: 320, height: 200, channels: 3, background: '#336699' } }).png().toBuffer();
    await expect(detectFile({ buffer: full.subarray(0, 40), declaredMime: 'image/png', originalName: 'broken.png' })).rejects.toMatchObject({ status: 400 });
    await expect(detectFile({ buffer: full.subarray(0, full.length - 30), declaredMime: 'image/png', originalName: 'cut.png' })).rejects.toMatchObject({ status: 400 });
    await expect(detectFile({ buffer: full, declaredMime: 'image/png', originalName: 'ok.png' })).resolves.toMatchObject({ category: 'image' });
  });
});
