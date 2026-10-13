import { Info } from 'lucide-react';
import { Field, Segmented, Select } from '@/components/ui';
import { LENGTHS, TONES, WRITING_FORMATS } from '@/lib/constants';

/** Format (optional — the assistant asks if missing), tone and length. */
export function WritingControls({ value, onChange, detectedFormat, clientTone }) {
  const detected = WRITING_FORMATS.find((f) => f.id === detectedFormat);
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-ink">Format</p>
        <Segmented
          ariaLabel="Format"
          size="sm"
          value={value.format}
          onChange={(format) => onChange({ format })}
          options={[{ value: '', label: 'Not selected' }, ...WRITING_FORMATS.map((f) => ({ value: f.id, label: f.label }))]}
          className="max-w-full flex-wrap"
        />
        <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted">
          <Info size={12} aria-hidden />
          {value.format
            ? 'The output will be written in this format.'
            : detected
              ? `Detected “${detected.label}” from your prompt.`
              : 'No format selected — the assistant will ask which one you need.'}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tone (optional)">
          <Select size="sm" value={value.tone} onChange={(e) => onChange({ tone: e.target.value })} placeholder={`Client default${clientTone ? ` (${clientTone})` : ''}`} options={TONES} />
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink">Length</p>
          <Segmented ariaLabel="Length" size="sm" value={value.length} onChange={(length) => onChange({ length })} options={LENGTHS.map((l) => ({ value: l.id, label: l.label }))} />
        </div>
      </div>
    </div>
  );
}
