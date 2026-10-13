import { Field, Input, Segmented, Select, Textarea } from '@/components/ui';
import { AD_OBJECTIVES, AD_OUTPUT_TYPES, AD_PLATFORMS, LENGTHS, TONES } from '@/lib/constants';
import { cn } from '@/lib/utils';

/** Structured campaign brief for the Advertising Copy tool. */
export function AdvertisingForm({ value, onChange, clientTone, error }) {
  const toggleType = (id) => {
    const set = new Set(value.outputTypes);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange({ outputTypes: AD_OUTPUT_TYPES.map((t) => t.id).filter((t) => set.has(t)) });
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Campaign name">
          <Input value={value.campaignName} onChange={(e) => onChange({ campaignName: e.target.value })} placeholder="e.g. Spring Clearance" size="sm" />
        </Field>
        <Field label="Call to action">
          <Input value={value.cta} onChange={(e) => onChange({ cta: e.target.value })} placeholder="e.g. Book a test drive" size="sm" />
        </Field>
        <Field label="Platform">
          <Select size="sm" value={value.platform} onChange={(e) => onChange({ platform: e.target.value })} placeholder="Any platform" options={AD_PLATFORMS} />
        </Field>
        <Field label="Objective">
          <Select size="sm" value={value.objective} onChange={(e) => onChange({ objective: e.target.value })} placeholder="Not specified" options={AD_OBJECTIVES} />
        </Field>
        <Field label="Target audience" hint="Prefilled from the client brand profile.">
          <Textarea rows={2} value={value.audience} onChange={(e) => onChange({ audience: e.target.value })} placeholder="Who should this reach?" className="text-[13px]" />
        </Field>
        <Field label="Product / service details">
          <Textarea rows={2} value={value.product} onChange={(e) => onChange({ product: e.target.value })} placeholder="What is being promoted? Key benefits, offers, dates…" className="text-[13px]" />
        </Field>
        <Field label="Tone">
          <Select size="sm" value={value.tone} onChange={(e) => onChange({ tone: e.target.value })} placeholder={`Client default${clientTone ? ` (${clientTone})` : ''}`} options={TONES} />
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink">Length</p>
          <Segmented ariaLabel="Length" size="sm" value={value.length} onChange={(length) => onChange({ length })} options={LENGTHS.map((l) => ({ value: l.id, label: l.label }))} />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Output types</legend>
        <div className="flex flex-wrap gap-1.5">
          {AD_OUTPUT_TYPES.map((t) => {
            const on = value.outputTypes.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggleType(t.id)}
                className={cn('inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-medium transition-colors focus-ring', on ? 'border-[#0E7490]/40 bg-[#E6F6FA] text-[#0E7490]' : 'border-line bg-surface text-muted hover:text-ink')}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {error && (
          <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
            {error}
          </p>
        )}
      </fieldset>
      <p className="text-[11.5px] text-muted">Use the prompt box below for any additional instructions.</p>
    </div>
  );
}
