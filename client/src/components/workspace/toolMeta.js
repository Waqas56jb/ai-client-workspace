import { AI_TOOLS } from '@/lib/constants';

export const TOOL_IDS = AI_TOOLS.map((t) => t.id);
export const isToolId = (id) => TOOL_IDS.includes(id);

/** Tool-specific example prompts for the empty conversation state. */
export function examplePrompts(toolId, { client, job } = {}) {
  const name = client?.name || 'the client';
  const event = job?.title || 'the campaign';
  switch (toolId) {
    case 'writing':
      return [
        `Write an email to ${name} customers announcing ${event}`,
        `Draft a short SMS reminder about ${event} for this weekend`,
        `WhatsApp message thanking our volunteers for ${event}`,
        'Rewrite this paragraph so it sounds warmer and more concise: …',
      ];
    case 'image':
      return [
        `Social poster for ${event} with the headline "Entries now open"`,
        `Clean hero banner for ${name} — bold headline, plenty of whitespace`,
        `Story graphic counting down to ${event}, CTA: "Register today"`,
      ];
    case 'advertising':
      return [
        `Emphasise early-bird pricing and urgency`,
        `Focus on families and first-time participants`,
        `Keep it premium and understated — no exclamation marks`,
      ];
    case 'vehicle':
      return [
        'Highlight the full service history and one-owner status',
        'Keep it under 120 words for a marketplace listing',
        'Lead with fuel economy and safety features',
      ];
    default:
      return [];
  }
}

const DEFAULT_AD_TYPES = ['headlines', 'social', 'cta'];

export const EMPTY_VEHICLE = {
  year: '',
  make: '',
  model: '',
  variant: '',
  mileage: '',
  fuelType: '',
  transmission: '',
  colour: '',
  condition: '',
  ownership: '',
  serviceHistory: '',
  warranty: '',
  features: [],
  stockRef: '',
};

/** Initial per-tool control state. Kept in the page so switching tools never loses input. */
export function initialForms({ client, job, defaultPreset }) {
  const brand = client?.brand || {};
  return {
    writing: { format: '', tone: '', length: 'medium' },
    image: {
      presetId: defaultPreset?.id || '',
      width: defaultPreset?.width || 1080,
      height: defaultPreset?.height || 1080,
      count: 1,
      editOutputId: null,
    },
    advertising: {
      campaignName: job?.title || '',
      platform: '',
      objective: '',
      audience: brand.targetAudience || '',
      product: brand.productInfo ? brand.productInfo.split('\n')[0].slice(0, 160) : '',
      tone: '',
      length: 'medium',
      cta: '',
      outputTypes: DEFAULT_AD_TYPES,
    },
    vehicle: { ...EMPTY_VEHICLE },
  };
}

export const VEHICLE_REQUIRED = [
  ['make', 'Make'],
  ['model', 'Model'],
  ['year', 'Year'],
];

export function vehicleMissingRequired(v = {}) {
  return VEHICLE_REQUIRED.filter(([k]) => !String(v[k] || '').trim()).map(([k]) => k);
}

export const MIN_DIM = 64;
export const MAX_DIM = 4096;

export function dimensionError(w, h) {
  const bad = (n) => !Number.isInteger(Number(n)) || Number(n) < MIN_DIM || Number(n) > MAX_DIM;
  if (bad(w) || bad(h)) return `Width and height must be whole numbers between ${MIN_DIM} and ${MAX_DIM}px.`;
  return null;
}

/** Human labels for request options shown in the inspector. */
export const OPTION_LABELS = {
  format: 'Format',
  tone: 'Tone',
  length: 'Length',
  campaignName: 'Campaign',
  platform: 'Platform',
  objective: 'Objective',
  audience: 'Audience',
  product: 'Product / service',
  cta: 'Call to action',
  outputTypes: 'Output types',
  year: 'Year',
  make: 'Make',
  model: 'Model',
  variant: 'Variant',
  mileage: 'Mileage',
  fuelType: 'Fuel',
  transmission: 'Transmission',
  colour: 'Colour',
  condition: 'Condition',
  ownership: 'Ownership',
  serviceHistory: 'Service history',
  warranty: 'Warranty',
  features: 'Features',
  stockRef: 'Stock ref',
  instructions: 'Instructions',
  count: 'Images',
};
