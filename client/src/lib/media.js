import { renderDemoDataUrl, rasterizeToPng } from './imageRenderer';
import { downloadBlob, downloadText, safeFilename } from './utils';
import { isMockMode } from './config';
import { apiClient } from '@/services/apiClient';
import { fileService } from '@/services/fileService';
import { versionText } from '@/services/versionService';

/* ───────────────────────── API-mode helpers ───────────────────────── */

/** Pulls a signed URL out of whatever shape the API used (`{ url }`, `{ signedUrl }`, a string…). */
function signedUrlOf(data) {
  if (!data) return null;
  if (typeof data === 'string') return /^https?:\/\//.test(data) ? data : null;
  return data.url || data.signedUrl || data.previewUrl || data.downloadUrl || null;
}

/**
 * Calls a download endpoint and returns a Blob. The API answers either with a
 * short-lived signed URL (JSON) — which we fetch — or with the content itself
 * (e.g. text/plain for text outputs).
 */
async function fetchDownload(path) {
  const res = await apiClient.get(path);
  if (typeof Blob !== 'undefined' && res.data instanceof Blob) return { blob: res.data, meta: null };
  if (typeof res.data === 'string' && !/^https?:\/\//.test(res.data)) {
    return { blob: new Blob([res.data], { type: res.contentType || 'text/plain;charset=utf-8' }), meta: null };
  }
  const url = signedUrlOf(res.data);
  if (!url) throw new Error('The server did not return a download link.');
  let file;
  try {
    file = await fetch(url);
  } catch {
    throw new Error('The file could not be downloaded. Check your connection and try again.');
  }
  if (!file.ok) throw new Error('The download link has expired or is unavailable. Try again.');
  return { blob: await file.blob(), meta: res.data };
}

/* ───────────────────────── public API ───────────────────────── */

/**
 * Image source for a generated image version.
 *  - API mode: the short-lived signed `image.previewUrl` returned by the server.
 *  - Demo mode: a data URL rendered at the requested size.
 */
export function versionImageSrc(version) {
  const img = version?.image;
  if (!img) return null;
  if (img.previewUrl) return img.previewUrl;
  if (!isMockMode || !img.render) return null;
  return renderDemoDataUrl({ ...img.render, width: img.requestedWidth, height: img.requestedHeight });
}

/**
 * Downloads a specific version of an output.
 *  - text → .txt
 *  - image → .png at EXACTLY the requested width × height
 *    (demo: rasterised in the browser; API: the stored file, whose dimensions the
 *    server verified after resizing)
 * Returns verified { width, height } for images.
 */
export async function downloadVersion(output, version) {
  const base = safeFilename(`${output.title}-v${version.versionNumber}`);
  if (!isMockMode) {
    const { blob } = await fetchDownload(`/outputs/${output.id}/versions/${version.id}/download`);
    if (output.kind === 'image') {
      const width = version.image?.actualWidth ?? version.image?.requestedWidth;
      const height = version.image?.actualHeight ?? version.image?.requestedHeight;
      const ext = /jpe?g/.test(blob.type) ? 'jpg' : /webp/.test(blob.type) ? 'webp' : 'png';
      downloadBlob(blob, `${base}-${width}x${height}.${ext}`);
      return { width, height };
    }
    downloadBlob(blob, `${base}.txt`);
    return null;
  }
  if (output.kind === 'image') {
    const { blob, width, height } = await rasterizeToPng(versionImageSrc(version), version.image.requestedWidth, version.image.requestedHeight);
    downloadBlob(blob, `${base}-${width}x${height}.png`);
    return { width, height };
  }
  downloadText(versionText(version), `${base}.txt`);
  return null;
}

/**
 * Resolves a preview/download source for a file record.
 * @returns {Promise<{ src: string|null, revoke?: () => void, unavailable?: string }>}
 */
export async function resolveFileSource(file) {
  if (!file) return { src: null, unavailable: 'File not found.' };
  if (!isMockMode) {
    if (file.previewUrl) return { src: file.previewUrl };
    const versionSrc = file.kind === 'image' ? versionImageSrc(file.output?.currentVersion) : null;
    if (versionSrc) return { src: versionSrc };
    // Text outputs have no stored object; their content is in the version.
    if (file.outputId && file.kind !== 'image') return { src: null };
    try {
      const res = await apiClient.get(`/files/${file.id}/preview`);
      const src = signedUrlOf(res.data);
      return src ? { src } : { src: null, unavailable: 'No preview is available for this file.' };
    } catch (err) {
      return { src: null, unavailable: err?.message || 'The preview could not be loaded.' };
    }
  }
  if (file.storage === 'bundled' && file.url) return { src: file.url };
  if (file.storage === 'generated' && file.output?.currentVersion) {
    return file.kind === 'image' ? { src: versionImageSrc(file.output.currentVersion) } : { src: null };
  }
  if (file.storage === 'browser') {
    const blob = await fileService.getLocalBlob(file.id);
    if (!blob) return { src: null, unavailable: 'This browser-held demo file is no longer available (browser storage was cleared or evicted).' };
    const src = URL.createObjectURL(blob);
    return { src, revoke: () => URL.revokeObjectURL(src) };
  }
  return { src: null, unavailable: 'Only the file record exists in demo mode — the original file was not uploaded to this browser.' };
}

/** Downloads any file record. Throws with a friendly message when unavailable. */
export async function downloadFileRecord(file) {
  if (!isMockMode) {
    if (file.outputId && file.output?.currentVersion) return downloadVersion(file.output, file.output.currentVersion);
    const { blob } = await fetchDownload(`/files/${file.id}/download`);
    downloadBlob(blob, file.name);
    return null;
  }
  if (file.storage === 'generated' && file.output) {
    return downloadVersion(file.output, file.output.currentVersion);
  }
  if (file.storage === 'bundled' && file.url) {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error('The sample file could not be fetched.');
    downloadBlob(await res.blob(), file.name);
    return null;
  }
  if (file.storage === 'browser') {
    const blob = await fileService.getLocalBlob(file.id);
    if (!blob) throw new Error('This browser-held demo file is no longer available.');
    downloadBlob(blob, file.name);
    return null;
  }
  throw new Error('No file content is available for this record in demo mode.');
}

export function canDownload(file) {
  if (!isMockMode) return !!file;
  return file?.storage === 'generated' || (file?.storage === 'bundled' && !!file.url) || file?.storage === 'browser';
}
