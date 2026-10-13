/**
 * Turns model text into the output shapes the frontend renders. Anything that
 * can be computed from the user's input (e.g. missing vehicle details) is
 * computed here from the input — never trusted from the model.
 */

export const WRITING_FORMAT_LABELS = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', other: 'Other text' };

export const AD_OUTPUT_TYPE_LABELS = {
  social: 'Social media ads',
  search: 'Search ad copy',
  promo: 'Promotional campaign',
  headlines: 'Headlines',
  short: 'Short descriptions',
  cta: 'Calls to action',
};

/** Vehicle form fields (same keys and labels as the frontend's VehicleForm). */
export const VEHICLE_FIELDS = [
  ['year', 'Year'],
  ['make', 'Make'],
  ['model', 'Model'],
  ['variant', 'Variant / trim'],
  ['mileage', 'Mileage'],
  ['fuelType', 'Fuel type'],
  ['transmission', 'Transmission'],
  ['colour', 'Exterior colour'],
  ['condition', 'Condition'],
  ['ownership', 'Ownership history'],
  ['serviceHistory', 'Service history'],
  ['warranty', 'Warranty details'],
  ['stockRef', 'Registration / stock reference'],
];

/** Same heuristic as the frontend: detects a writing format named in the prompt. */
export function detectFormat(prompt = '') {
  const p = String(prompt).toLowerCase();
  if (/\bwhats\s?app\b/.test(p)) return 'whatsapp';
  if (/\b(sms|text message)\b/.test(p)) return 'sms';
  if (/\b(e-?mail|newsletter)\b/.test(p)) return 'email';
  return null;
}

/** Removes a leading/trailing markdown code fence the model may add. */
export function cleanModelText(text = '') {
  return String(text)
    .replace(/^\s*```[a-z]*\s*\n/i, '')
    .replace(/\n\s*```\s*$/i, '')
    .trim();
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Title from the first line / "Subject:" line of generated copy. */
export function deriveWritingTitle(content, format) {
  const lines = String(content || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const subject = lines.find((l) => /^subject\s*:/i.test(l));
  let base = subject ? subject.replace(/^subject\s*:\s*/i, '') : lines[0] || 'Draft';
  base = base.replace(/^#+\s*/, '').replace(/[*_]/g, '').trim() || 'Draft';
  const label = WRITING_FORMAT_LABELS[format];
  const suffix = label && format !== 'other' ? ` — ${label === 'Email' ? 'email' : label}` : '';
  return clip(clip(base, 60) + suffix, 160);
}

/**
 * Parses "Label: text" blocks into sections [{ id, label, text }].
 * Continuation lines belong to the previous section; a label alone on a line
 * takes the following lines as its text. Falls back to one section.
 */
export function parseAdvertisingSections(text) {
  const cleaned = cleanModelText(text);
  const sections = [];
  let current = null;
  const labelRe = /^\s*(?:[-*•]\s*)?(?:\*\*)?([A-Za-z0-9][^:\n]{0,58}?)(?:\*\*)?\s*:\s*(.*)$/;
  for (const raw of cleaned.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(labelRe);
    if (m && !/^https?$/i.test(m[1]) && m[1].split(/\s+/).length <= 8) {
      current = { label: m[1].replace(/\*+/g, '').trim(), text: m[2].replace(/\*+/g, '').trim() };
      sections.push(current);
    } else if (current) {
      current.text = current.text ? `${current.text}\n${line}` : line;
    } else {
      current = { label: 'Copy', text: line };
      sections.push(current);
    }
  }
  const valid = sections.filter((s) => s.text);
  if (!valid.length) return [{ id: 's1', label: 'Copy', text: cleaned || '' }];
  return valid.map((s, i) => ({ id: `s${i + 1}`, label: clip(s.label, 80), text: s.text }));
}

export function advertisingTitle(options = {}) {
  const campaign = options.campaignName || 'Campaign';
  const types = (options.outputTypes?.length ? options.outputTypes : ['headlines', 'social', 'cta'])
    .map((t) => AD_OUTPUT_TYPE_LABELS[t]?.toLowerCase())
    .filter(Boolean);
  return clip(`${campaign} — ${types.join(', ') || 'ad copy'}`, 80);
}

const supplied = (v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '');

/** Labels of vehicle fields that were NOT supplied (computed from input only). */
export function vehicleMissing(options = {}, clientWarranty = '') {
  const missing = VEHICLE_FIELDS.filter(([k]) => k !== 'warranty' && !supplied(options[k])).map(([, label]) => label);
  if (!supplied(options.warranty) && !supplied(clientWarranty)) missing.push('Warranty details (no client warranty wording on file)');
  return missing;
}

export function vehicleName(options = {}) {
  return [options.year, options.make, options.model, options.variant].filter(supplied).join(' ') || 'Vehicle';
}

export function vehicleTitle(options = {}) {
  return clip(`${vehicleName(options)} listing`, 160);
}
