import { Loader2 } from 'lucide-react';
import { ImageGallery } from './ImageGallery';
import { OutputReference, TextOutputPanel } from './TextOutputPanel';

/**
 * Renders the outputs attached to an assistant message as rich result cards.
 * Outputs that appear again in a later message render as a compact reference
 * here, so the latest state is shown once.
 */
export function MessageOutputs({ message, outputsById, latestMessageFor, loading, selectedOutputId, onSelect, onShowDetails, onEditImage, presetsById }) {
  const outputs = message.outputIds.map((id) => outputsById[id]).filter(Boolean);
  if (!outputs.length) {
    return loading ? (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Loader2 size={13} className="animate-spin" aria-hidden /> Loading results…
      </p>
    ) : (
      <p className="text-xs text-muted">The output from this message is no longer available.</p>
    );
  }
  const latest = outputs.filter((o) => latestMessageFor[o.id] === message.id);
  const earlier = outputs.filter((o) => latestMessageFor[o.id] !== message.id);
  const images = latest.filter((o) => o.kind === 'image');
  const texts = latest.filter((o) => o.kind !== 'image');
  return (
    <div className="space-y-3">
      {earlier.map((o) => (
        <OutputReference key={o.id} output={o} onSelect={onSelect} />
      ))}
      {images.length > 0 && <ImageGallery outputs={images} selectedOutputId={selectedOutputId} onSelect={onSelect} onShowDetails={onShowDetails} onEditImage={onEditImage} presetsById={presetsById} />}
      {texts.map((o) => (
        <TextOutputPanel key={o.id} output={o} selected={selectedOutputId === o.id} onSelect={onSelect} onShowDetails={onShowDetails} />
      ))}
    </div>
  );
}
