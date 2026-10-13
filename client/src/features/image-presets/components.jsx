import { useMemo } from 'react';
import { renderDemoDataUrl } from '@/lib/imageRenderer';
import { aspectRatio, cn } from '@/lib/utils';

/** Proportional outline of a preset's aspect ratio inside a fixed square box. */
export function AspectShape({ width, height, color = '#6257E8', box = 88 }) {
  const r = width / height || 1;
  const w = r >= 1 ? box : Math.max(14, box * r);
  const h = r >= 1 ? Math.max(14, box / r) : box;
  return (
    <div className="flex items-center justify-center" style={{ width: box, height: box }} aria-hidden>
      <div className="relative rounded-[5px] border-2 bg-white/70" style={{ width: w, height: h, borderColor: color }}>
        <span className="absolute inset-[12%] rounded-[3px] border border-dashed" style={{ borderColor: `${color}66` }} />
      </div>
    </div>
  );
}

const DEFAULT_BRAND = { primaryColor: '#6257E8', secondaryColor: '#8B7CFF', accentColor: '#FFC531', headingFont: 'Inter' };

/**
 * Scaled live preview of a preset rendered with the demo renderer at the exact
 * preset dimensions (then scaled down by CSS to fit), plus a safe-area overlay.
 */
export function PresetPreview({ width, height, name, client, showSafeArea, className }) {
  const valid = Number.isFinite(width) && Number.isFinite(height) && width >= 64 && height >= 64 && width <= 8192 && height <= 8192;
  const w = valid ? width : 1080;
  const h = valid ? height : 1080;
  const brand = client?.brand || DEFAULT_BRAND;
  const src = useMemo(
    () =>
      renderDemoDataUrl({
        width: w,
        height: h,
        headline: name || 'Your headline here',
        subline: 'Demo layout preview',
        cta: 'Learn more',
        brandName: client?.name || 'StudioFlow',
        primary: brand.primaryColor,
        secondary: brand.secondaryColor,
        accent: brand.accentColor,
        font: brand.headingFont || brand.fontFamily,
        seed: client?.id || 'preset',
        showSafeArea,
      }),
    [w, h, name, client?.name, client?.id, brand.primaryColor, brand.secondaryColor, brand.accentColor, brand.headingFont, brand.fontFamily, showSafeArea],
  );
  const ratio = w / h;

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="checkerboard flex h-[340px] items-center justify-center rounded-xl border border-line p-5 sm:h-[400px]">
        <div className="relative max-h-full max-w-full shadow-pop" style={{ aspectRatio: `${w} / ${h}`, height: ratio >= 1 ? 'auto' : '100%', width: ratio >= 1 ? '100%' : 'auto' }}>
          <img src={src} alt={`Demo preview at ${w} × ${h} pixels`} className="block h-full w-full rounded-[3px]" />
          <span className="absolute left-1.5 top-1.5 rounded bg-ink/75 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-white">
            {w} × {h} px
          </span>
          {showSafeArea && <span className="absolute bottom-1.5 right-1.5 rounded bg-ink/75 px-1.5 py-0.5 text-[10.5px] font-medium text-white">Safe area · 7% inset</span>}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Aspect ratio <span className="font-mono font-medium text-ink">{aspectRatio(w, h)}</span> · {ratio > 1.02 ? 'Landscape' : ratio < 0.98 ? 'Portrait' : 'Square'}
        </span>
        <span>{client ? `${client.name} brand colours` : 'StudioFlow default colours'} · demo render</span>
      </div>
      {!valid && <p className="mt-1.5 text-xs text-warning">Enter dimensions between 64 and 8192 px to update the preview.</p>}
    </div>
  );
}
