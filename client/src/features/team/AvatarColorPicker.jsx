import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const AVATAR_COLORS = [
  { value: '#6257E8', label: 'Violet' },
  { value: '#0E7490', label: 'Teal' },
  { value: '#C2410C', label: 'Ember' },
  { value: '#15803D', label: 'Green' },
  { value: '#2F6FDB', label: 'Blue' },
  { value: '#BE185D', label: 'Rose' },
  { value: '#B7791F', label: 'Amber' },
  { value: '#17182B', label: 'Ink' },
];

/** Radio-style swatch picker for avatar colours. */
export function AvatarColorPicker({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Avatar colour" className="flex flex-wrap gap-2">
      {AVATAR_COLORS.map((c) => {
        const active = value?.toUpperCase() === c.value.toUpperCase();
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={c.label}
            title={c.label}
            onClick={() => onChange(c.value)}
            className={cn('flex h-8 w-8 items-center justify-center rounded-full transition-transform focus-ring hover:scale-105', active && 'ring-2 ring-offset-2')}
            style={{ backgroundColor: c.value, '--tw-ring-color': c.value }}
          >
            {active && <Check size={15} strokeWidth={3} className="text-white" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
