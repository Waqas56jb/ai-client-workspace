import { useState } from 'react';
import { Plus, ShieldCheck, X } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { FUEL_TYPES, TRANSMISSIONS, VEHICLE_CONDITIONS } from '@/lib/constants';

const sm = 'h-8 text-[13px]';

/** Structured vehicle details. Keys match the vehicle generator exactly. */
export function VehicleForm({ value, onChange, errors = {}, clientWarranty }) {
  const [feature, setFeature] = useState('');
  const set = (k) => (e) => onChange({ [k]: e.target.value });
  const addFeature = () => {
    const f = feature.trim();
    if (!f) return;
    if (!value.features.some((x) => x.toLowerCase() === f.toLowerCase())) onChange({ features: [...value.features, f] });
    setFeature('');
  };
  const year = new Date().getFullYear() + 1;

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-1.5 rounded-lg bg-success-soft/70 px-2.5 py-2 text-[11.5px] leading-4 text-success">
        <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
        Listings use only the details supplied here. Anything left blank is reported as missing — never invented.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Make" required error={errors.make}>
          <Input value={value.make} onChange={set('make')} placeholder="Toyota" className={sm} />
        </Field>
        <Field label="Model" required error={errors.model}>
          <Input value={value.model} onChange={set('model')} placeholder="RAV4" className={sm} />
        </Field>
        <Field label="Year" required error={errors.year}>
          <Input type="number" min={1950} max={year} inputMode="numeric" value={value.year} onChange={set('year')} placeholder="2021" className={sm} />
        </Field>
        <Field label="Variant / trim">
          <Input value={value.variant} onChange={set('variant')} placeholder="GXL" className={sm} />
        </Field>
        <Field label="Mileage (km)">
          <Input inputMode="numeric" value={value.mileage} onChange={set('mileage')} placeholder="48,200" className={sm} />
        </Field>
        <Field label="Exterior colour">
          <Input value={value.colour} onChange={set('colour')} placeholder="Glacier White" className={sm} />
        </Field>
        <Field label="Fuel type">
          <Select size="sm" value={value.fuelType} onChange={set('fuelType')} placeholder="Not specified" options={FUEL_TYPES} />
        </Field>
        <Field label="Transmission">
          <Select size="sm" value={value.transmission} onChange={set('transmission')} placeholder="Not specified" options={TRANSMISSIONS} />
        </Field>
        <Field label="Condition">
          <Select size="sm" value={value.condition} onChange={set('condition')} placeholder="Not specified" options={VEHICLE_CONDITIONS} />
        </Field>
        <Field label="Ownership history">
          <Input value={value.ownership} onChange={set('ownership')} placeholder="One owner" className={sm} />
        </Field>
        <Field label="Service history">
          <Input value={value.serviceHistory} onChange={set('serviceHistory')} placeholder="Full dealer service history" className={sm} />
        </Field>
        <Field label="Registration / stock ref">
          <Input value={value.stockRef} onChange={set('stockRef')} placeholder="HS-2187" className={sm} />
        </Field>
      </div>
      <Field label="Warranty details" hint={clientWarranty ? 'Leave blank to use the client’s standard warranty wording.' : 'No client warranty wording on file — leave blank to report it as missing.'}>
        <Textarea rows={2} value={value.warranty} onChange={set('warranty')} placeholder="e.g. Balance of 7-year factory warranty" className="text-[13px]" />
      </Field>
      <div>
        <label htmlFor="ws-vehicle-feature" className="mb-1.5 block text-[13px] font-medium text-ink">
          Key features
        </label>
        <div className="flex gap-2">
          <Input
            id="ws-vehicle-feature"
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addFeature();
              }
            }}
            placeholder="e.g. Adaptive cruise control"
            className={sm}
          />
          <Button size="sm" icon={Plus} onClick={addFeature} disabled={!feature.trim()}>
            Add
          </Button>
        </div>
        {value.features.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Key features">
            {value.features.map((f) => (
              <li key={f} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2.5 pr-1 text-[12px] text-ink">
                {f}
                <button type="button" onClick={() => onChange({ features: value.features.filter((x) => x !== f) })} className="rounded-full p-0.5 text-muted hover:bg-canvas hover:text-danger focus-ring" aria-label={`Remove ${f}`}>
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11.5px] text-muted">Use the prompt box below for additional instructions.</p>
    </div>
  );
}
