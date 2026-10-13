/**
 * Demo image renderer.
 *
 * The frontend has no real image-generation service, so "generated" images are
 * deterministic SVG compositions built from the client's brand colours and the
 * prompt. They are clearly labelled as demo previews in the UI.
 *
 * Because the SVG is authored at the requested width/height, and PNG exports are
 * rasterised on a canvas of exactly that size, this also demonstrates the
 * post-processing stage a real pipeline needs (resize/crop to exact pixels).
 */

function hashString(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function esc(text = '') {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function wrap(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((w) => {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  });
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/**
 * @param {object} p
 * @param {number} p.width
 * @param {number} p.height
 * @param {string} p.headline
 * @param {string} [p.subline]
 * @param {string} [p.cta]
 * @param {string} [p.brandName]
 * @param {string} p.primary
 * @param {string} p.secondary
 * @param {string} p.accent
 * @param {string} [p.background]
 * @param {string} [p.font]
 * @param {string|number} [p.seed]
 * @param {boolean} [p.showSafeArea]
 */
export function renderDemoSvg(p) {
  const width = Math.max(64, Math.round(Number(p.width) || 1080));
  const height = Math.max(64, Math.round(Number(p.height) || 1080));
  const seed = hashString(`${p.seed ?? ''}${p.headline ?? ''}`);
  const rand = rng(seed);
  const variant = seed % 4;
  const min = Math.min(width, height);
  const pad = Math.round(min * 0.07);
  const primary = p.primary || '#6257E8';
  const secondary = p.secondary || '#8B7CFF';
  const accent = p.accent || '#FFC531';
  const font = esc(p.font || 'Inter');
  const landscape = width / height > 1.6;

  const headSize = Math.round(min * (landscape ? 0.13 : 0.085));
  const subSize = Math.round(headSize * 0.42);
  const maxChars = Math.max(8, Math.round((width - pad * 2) / (headSize * 0.56)));
  const headLines = wrap(p.headline || 'Your headline here', landscape ? maxChars * 0.6 : maxChars);
  const headBlockH = headLines.length * headSize * 1.08;

  const shapes = [];
  for (let i = 0; i < 6; i += 1) {
    const r = min * (0.12 + rand() * 0.38);
    const cx = width * rand();
    const cy = height * rand();
    const fill = [secondary, accent, '#ffffff'][i % 3];
    const op = i % 3 === 2 ? 0.07 : 0.18 + rand() * 0.2;
    shapes.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="${fill}" opacity="${op.toFixed(2)}"/>`);
  }
  if (variant === 1 || variant === 3) {
    shapes.push(
      `<path d="M0 ${height * 0.72} L${width} ${height * 0.42} L${width} ${height} L0 ${height} Z" fill="${secondary}" opacity="0.35"/>`,
    );
  }
  if (variant === 2) {
    for (let i = 0; i < 5; i += 1) {
      const y = height * (0.15 + i * 0.16);
      shapes.push(
        `<path d="M0 ${y} C ${width * 0.3} ${y - min * 0.06}, ${width * 0.6} ${y + min * 0.06}, ${width} ${y}" stroke="#ffffff" stroke-opacity="0.12" stroke-width="${(min * 0.012).toFixed(0)}" fill="none"/>`,
      );
    }
  }

  const textX = pad;
  const headY = landscape ? height / 2 - headBlockH / 2 + headSize * 0.85 : height * 0.5 - headBlockH / 2 + headSize * 0.85;
  const headTspans = headLines
    .map((l, i) => `<tspan x="${textX}" dy="${i === 0 ? 0 : headSize * 1.08}">${esc(l)}</tspan>`)
    .join('');
  const subY = headY + headBlockH + subSize * 0.6;
  const ctaH = Math.round(subSize * 2.2);
  const ctaText = esc(p.cta || '');
  const ctaW = Math.round(ctaText.length * subSize * 0.62 + subSize * 2.4);
  const ctaY = Math.min(height - pad - ctaH, subY + subSize * 1.6);
  const logoSize = Math.round(min * 0.085);
  const brand = esc(p.brandName || '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${primary}"/>
<stop offset="1" stop-color="${variant === 3 ? accent : secondary}" stop-opacity="${variant === 3 ? 0.85 : 1}"/>
</linearGradient>
<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></linearGradient>
</defs>
<rect width="${width}" height="${height}" fill="url(#bg)"/>
${shapes.join('\n')}
<rect width="${width}" height="${height}" fill="url(#shade)"/>
<g font-family="${font}, Inter, Arial, sans-serif">
<rect x="${pad}" y="${pad}" width="${logoSize}" height="${logoSize}" rx="${logoSize * 0.24}" fill="#ffffff" opacity="0.95"/>
<text x="${pad + logoSize / 2}" y="${pad + logoSize * 0.64}" font-size="${logoSize * 0.42}" font-weight="800" fill="${primary}" text-anchor="middle">${esc((p.brandName || 'SF').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase())}</text>
<text x="${pad + logoSize * 1.25}" y="${pad + logoSize * 0.62}" font-size="${logoSize * 0.34}" font-weight="700" fill="#ffffff" opacity="0.95">${brand}</text>
<text x="${textX}" y="${headY}" font-size="${headSize}" font-weight="800" fill="#ffffff" letter-spacing="-0.5">${headTspans}</text>
${p.subline ? `<text x="${textX}" y="${subY}" font-size="${subSize}" font-weight="500" fill="#ffffff" opacity="0.9">${esc(p.subline)}</text>` : ''}
${ctaText ? `<rect x="${textX}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${ctaH / 2}" fill="${accent}"/><text x="${textX + ctaW / 2}" y="${ctaY + ctaH * 0.64}" font-size="${subSize * 0.9}" font-weight="700" fill="${primary}" text-anchor="middle">${ctaText}</text>` : ''}
</g>
${p.showSafeArea ? `<rect x="${pad}" y="${pad}" width="${width - pad * 2}" height="${height - pad * 2}" fill="none" stroke="#ffffff" stroke-dasharray="12 10" stroke-opacity="0.6" stroke-width="2"/>` : ''}
</svg>`;
}

export function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function renderDemoDataUrl(params) {
  return svgToDataUrl(renderDemoSvg(params));
}

/**
 * Rasterises an SVG/image URL to a PNG Blob at exactly width × height.
 * Returns { blob, width, height } with the verified canvas dimensions.
 */
export async function rasterizeToPng(src, width, height) {
  const img = new Image();
  img.decoding = 'async';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('Could not load image for export'));
    img.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  // cover-fit: crop to the exact requested aspect ratio
  const scale = Math.max(canvas.width / (img.naturalWidth || canvas.width), canvas.height / (img.naturalHeight || canvas.height));
  const dw = (img.naturalWidth || canvas.width) * scale;
  const dh = (img.naturalHeight || canvas.height) * scale;
  ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG export failed');
  return { blob, width: canvas.width, height: canvas.height };
}
