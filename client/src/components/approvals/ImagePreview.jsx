import { useEffect, useState } from 'react';
import { Download, Maximize, Minus, Plus, Grid3x3, Square } from 'lucide-react';
import { Dialog, Button, Badge, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Full-screen image preview with zoom controls and a checkerboard / plain
 * background toggle for transparent images.
 * @param {{ open, onClose, src, title, subtitle?, requested?: {width,height}, onDownload?, footerNote? }} props
 */
export function ImagePreviewDialog({ open, onClose, src, title, subtitle, requested, onDownload, footerNote }) {
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [bg, setBg] = useState('checker');
  const [natural, setNatural] = useState(null);

  useEffect(() => {
    if (open) {
      setZoom(1);
      setFit(true);
    }
  }, [open, src]);

  const change = (delta) => {
    setFit(false);
    setZoom((z) => Math.min(4, Math.max(0.1, +(z + delta).toFixed(2))));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="full"
      title={title}
      description={subtitle}
      bodyClassName="p-0"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {requested && <Badge tone="brand">Requested {requested.width} × {requested.height}px</Badge>}
            {natural && <Badge>Preview source {natural.w} × {natural.h}px</Badge>}
            {footerNote && <span>{footerNote}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <Tooltip content="Zoom out">
              <Button size="icon-sm" icon={Minus} onClick={() => change(-0.25)} aria-label="Zoom out" />
            </Tooltip>
            <span className="w-14 text-center text-xs font-medium tabular-nums text-ink" aria-live="polite">
              {fit ? 'Fit' : `${Math.round(zoom * 100)}%`}
            </span>
            <Tooltip content="Zoom in">
              <Button size="icon-sm" icon={Plus} onClick={() => change(0.25)} aria-label="Zoom in" />
            </Tooltip>
            <Tooltip content="Fit to screen">
              <Button size="icon-sm" icon={Maximize} onClick={() => setFit(true)} aria-label="Fit to screen" />
            </Tooltip>
            <Tooltip content={bg === 'checker' ? 'Plain background' : 'Transparency grid'}>
              <Button size="icon-sm" icon={bg === 'checker' ? Square : Grid3x3} onClick={() => setBg((b) => (b === 'checker' ? 'plain' : 'checker'))} aria-label="Toggle background" />
            </Tooltip>
            {onDownload && (
              <Button variant="primary" size="sm" icon={Download} onClick={onDownload}>
                Download
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className={cn('flex h-[70vh] items-center justify-center overflow-auto scrollbar-thin', bg === 'checker' ? 'checkerboard' : 'bg-[#2A2B40]')}>
        {src ? (
          <img
            src={src}
            alt={title}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={fit ? { maxWidth: '100%', maxHeight: '100%' } : { width: natural ? natural.w * zoom : undefined, maxWidth: 'none' }}
            className={cn('select-none shadow-pop transition-[width] duration-150', fit && 'object-contain')}
            draggable={false}
          />
        ) : (
          <p className="text-sm text-muted">Preview unavailable</p>
        )}
      </div>
    </Dialog>
  );
}
