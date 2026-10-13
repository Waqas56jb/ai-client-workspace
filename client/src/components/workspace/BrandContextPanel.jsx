import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Palette } from 'lucide-react';
import { ColorSwatch } from '@/components/ui';
import { ClientLogo } from '@/components/data-display/Entities';
import { cn } from '@/lib/utils';

function Clamp({ text, lines = 3 }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 140;
  return (
    <div>
      <p className={cn('whitespace-pre-line text-[12.5px] leading-5 text-ink/85', !open && long && (lines === 2 ? 'line-clamp-2' : 'line-clamp-3'))}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-0.5 inline-flex items-center gap-0.5 text-[11.5px] font-medium text-brand hover:underline focus-ring rounded">
          {open ? 'Less' : 'More'}
          <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      )}
    </div>
  );
}

function Item({ label, children }) {
  if (!children) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      {children}
    </div>
  );
}

/**
 * Selected client's brand context: logo, colours, fonts, tone and guidelines.
 * `variant="image"` emphasises image guidance; `compact` renders a slim strip.
 */
export function BrandContextPanel({ client, variant = 'full', compact }) {
  const b = client?.brand || {};
  const colours = [
    ['Primary', b.primaryColor],
    ['Secondary', b.secondaryColor],
    ['Accent', b.accentColor],
    ['Background', b.backgroundColor],
  ].filter(([, c]) => c);
  const fonts = [b.headingFont && `Headings: ${b.headingFont}`, b.bodyFont && `Body: ${b.bodyFont}`, !b.headingFont && !b.bodyFont && b.fontFamily && `Font: ${b.fontFamily}`].filter(Boolean);

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-canvas/70 px-2.5 py-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink">
          <ClientLogo client={client} size="xs" />
          {client?.name} brand
        </span>
        <span className="flex items-center gap-1">
          {colours.map(([label, c]) => (
            <ColorSwatch key={label} color={c} size="sm" label={undefined} />
          ))}
        </span>
        {fonts.length > 0 && <span className="truncate text-[11.5px] text-muted">{fonts.join(' · ')}</span>}
        {b.imageStyle && <span className="w-full truncate text-[11.5px] text-muted" title={b.imageStyle}>Image style: {b.imageStyle}</span>}
      </div>
    );
  }

  const isImage = variant === 'image';
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ClientLogo client={client} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-ink">{client?.name}</p>
          <p className="truncate text-xs text-muted">{client?.industry || 'Client'}</p>
        </div>
        <Link to={`/clients/${client?.id}/brand`} className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand hover:underline focus-ring rounded">
          Brand profile <ArrowUpRight size={12} aria-hidden />
        </Link>
      </div>

      {colours.length > 0 && (
        <Item label="Colours">
          <div className="grid grid-cols-2 gap-1.5">
            {colours.map(([label, c]) => (
              <span key={label} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
                <span className="h-5 w-5 shrink-0 rounded-md border border-black/10" style={{ backgroundColor: c }} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[11px] text-muted">{label}</span>
                  <span className="block font-mono text-[11.5px] uppercase text-ink">{c}</span>
                </span>
              </span>
            ))}
          </div>
        </Item>
      )}

      {fonts.length > 0 && (
        <Item label="Typography">
          <ul className="space-y-0.5 text-[12.5px] text-ink">
            {fonts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Item>
      )}

      {!isImage && (b.tone || b.formality || b.spelling) && (
        <Item label="Voice">
          <p className="text-[12.5px] text-ink">{[b.tone, b.formality, b.spelling].filter(Boolean).join(' · ')}</p>
          {b.useWords && <p className="mt-1 text-[11.5px] text-muted">Use: {b.useWords}</p>}
          {b.avoidWords && <p className="mt-0.5 text-[11.5px] text-muted">Avoid: {b.avoidWords}</p>}
        </Item>
      )}

      {b.imageStyle && (
        <Item label="Image style">
          <Clamp text={b.imageStyle} lines={2} />
        </Item>
      )}
      {b.guidelines && (
        <Item label="Brand guidelines">
          <Clamp text={b.guidelines} />
        </Item>
      )}
      {!isImage && b.targetAudience && (
        <Item label="Target audience">
          <Clamp text={b.targetAudience} lines={2} />
        </Item>
      )}
      {!colours.length && !b.guidelines && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Palette size={14} aria-hidden /> No brand profile details yet.
        </p>
      )}
      <p className="rounded-lg bg-canvas px-2.5 py-2 text-[11.5px] leading-4 text-muted">
        Only {client?.name}’s profile is sent with requests from this task — no other client’s branding can enter the prompt.
      </p>
    </div>
  );
}
