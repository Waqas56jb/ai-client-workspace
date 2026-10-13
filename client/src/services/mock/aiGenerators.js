import { detectFormat, parseDirectives } from '@/lib/promptHeuristics';

export { detectFormat, parseDirectives };
/**
 * Simulated AI generators. They build polished, template-based outputs from the
 * prepared request so the full workflow can be demonstrated without a model.
 * Nothing here calls OpenAI; every response is labelled as simulated in the UI.
 */
import { WRITING_FORMATS, AD_OUTPUT_TYPES } from '@/lib/constants';

const titleCase = (s = '') => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
const firstSentence = (s = '') => s.split(/(?<=[.!?])\s/)[0];
const clean = (s = '') => s.replace(/\s+/g, ' ').trim();

/** Extracts "quoted text" from the prompt, if any. */
function quoted(prompt = '') {
  const m = prompt.match(/[“"]([^”"]{2,80})[”"]/);
  return m ? m[1] : null;
}

/** Strips imperative lead-ins: "Write an email about X" → "X". */
function topicOf(prompt = '') {
  let t = clean(prompt)
    .replace(/^(please\s+)?(write|draft|create|make|generate|compose|produce|prepare|edit|rewrite|give me|i need)\s+(me\s+)?(an?|the|some)?\s*/i, '')
    .replace(/^(short|quick|brief|long|friendly|formal)\s+/i, '')
    .replace(/^(email|sms|text message|whatsapp( message)?|message|post|copy|ad|ads)\s+(to|for|about|announcing|reminding|inviting)?\s*/i, '');
  t = firstSentence(t).replace(/[.!?]$/, '');
  // Lower-case a leading capital so the topic reads naturally mid-sentence (keeps acronyms like "MOWSC")
  if (/^[A-Z][a-z]/.test(t)) t = t[0].toLowerCase() + t.slice(1);
  return t || 'our latest update';
}

function applyDirectives(text, d) {
  let out = text;
  if (d.prefix) out = `${d.prefix}\n\n${out}`;
  if (d.append) out = `${out}\n\n${d.append}`;
  return out;
}


// ── Writing ──────────────────────────────────────────────────────────────
export function generateWriting(req) {
  const { client, options, prompt, instructions } = req;
  const d = parseDirectives(instructions);
  const biz = client.business?.businessName || client.name;
  const w = client.writingPreferences || {};
  const tone = options.tone || w.tone || req.workspaceDefaults?.defaultTone || 'Professional';
  const topic = topicOf(prompt);
  const length = options.length || 'medium';
  const disclaimer = client.approvedTerms?.disclaimers;
  const site = client.business?.website;
  const audience = client.additional?.targetAudience;
  const greeting = { Casual: 'Hi there', Balanced: 'Hello', Formal: 'Dear customer' }[w.formality] || 'Hello';
  const signOff = d.signOff || (tone === 'Warm' || tone === 'Friendly' ? 'Warm regards' : 'Kind regards');

  let content;
  let title;
  const fmt = options.format;
  if (fmt === 'email') {
    const paras = [
      `We wanted to let you know about ${topic}.`,
      length !== 'short' ? `As always, ${biz} is focused on ${w.useWords ? w.useWords.split(',')[0].trim() : 'making this easy for you'}${audience ? ` — and this is designed with ${audience.split(',')[0].toLowerCase()} in mind` : ''}.` : null,
      length === 'long' ? `Here is what you need to know:\n\n• What: ${titleCase(topic)}\n• Where: ${client.business?.address || 'see our website for details'}\n• Questions: ${client.business?.phone || client.business?.email || 'reply to this email'}` : null,
      site ? `Find out more at ${site}.` : null,
    ].filter(Boolean);
    content = `Subject: ${titleCase(topic).slice(0, 70)}\n\n${greeting},\n\n${paras.join('\n\n')}\n\n${signOff},\nThe ${biz} team${disclaimer ? `\n\n${disclaimer}` : ''}`;
    title = `${titleCase(topic).slice(0, 48)} — email`;
  } else if (fmt === 'sms') {
    const base = `${client.name}: ${topic.charAt(0).toUpperCase()}${topic.slice(1)}.${site ? ` ${site}` : ''}`;
    const optOut = ' Reply STOP to opt out';
    content = (base.length + optOut.length > 160 ? `${base.slice(0, 160 - optOut.length - 1)}…` : base) + optOut;
    title = `${titleCase(topic).slice(0, 48)} — SMS`;
  } else if (fmt === 'whatsapp') {
    content = `${greeting} 👋\n\nQuick note from ${biz}: ${topic}.\n\n${length !== 'short' ? `Any questions? Just reply here and our team will get back to you.\n\n` : ''}${d.signOff || `— ${biz}`}`;
    title = `${titleCase(topic).slice(0, 48)} — WhatsApp`;
  } else {
    content = `${titleCase(topic)}\n\n${biz} ${length === 'short' ? 'brings you' : 'is pleased to share'} ${topic}.${length !== 'short' && w.useWords ? ` ${titleCase(w.useWords.split(',')[0].trim())} is at the heart of everything we do.` : ''}${length === 'long' && audience ? `\n\nMade for ${audience.toLowerCase()}.` : ''}`;
    title = `${titleCase(topic).slice(0, 48)}`;
  }

  return {
    outputs: [{ kind: 'text', title, format: fmt, content: applyDirectives(content, d) }],
    reply: `Here is a ${WRITING_FORMATS.find((f) => f.id === fmt)?.label.toLowerCase() || 'draft'} in ${client.name}’s ${tone.toLowerCase()} voice${w.spelling ? ` (${w.spelling})` : ''}.`,
  };
}

// ── Images ───────────────────────────────────────────────────────────────
export function generateImages(req, { variantSeed = Date.now() } = {}) {
  const { client, options, prompt, preset } = req;
  const b = client.brand || {};
  const count = Math.min(4, Math.max(1, Number(options.count) || 1));
  const width = Number(options.width) || preset?.width || 1080;
  const height = Number(options.height) || preset?.height || 1080;
  const headline = quoted(prompt) || titleCase(topicOf(prompt).split(' ').slice(0, 6).join(' '));
  const cta = (prompt.match(/cta[:\s]+[“"]?([^”".,\n]{2,24})/i) || [])[1] || 'Learn more';
  const sublines = [req.job?.title, client.additional?.targetAudience?.split(',')[0], client.business?.website, client.industry].filter(Boolean);

  const outputs = Array.from({ length: count }, (_, i) => ({
    kind: 'image',
    title: `${headline.slice(0, 40)}${count > 1 ? ` (${String.fromCharCode(65 + i)})` : ''}`,
    image: {
      render: {
        headline,
        subline: sublines[i % Math.max(1, sublines.length)] || '',
        cta: titleCase(cta.trim()),
        brandName: client.name,
        primary: b.primaryColor,
        secondary: b.secondaryColor,
        accent: b.accentColor,
        font: b.headingFont || b.fontFamily,
        seed: `${variantSeed}-${i}`,
      },
      requestedWidth: width,
      requestedHeight: height,
      presetId: preset?.id || null,
      prompt,
      referenceFileIds: req.attachments.map((a) => a.id),
    },
  }));

  return {
    outputs,
    reply: `Created ${count} demo image${count > 1 ? 's' : ''} at ${width} × ${height}px using ${client.name}’s brand colours${preset ? ` and the “${preset.name}” preset` : ''}. These are rendered placeholders — no image model is connected in demo mode.`,
  };
}

// ── Advertising ──────────────────────────────────────────────────────────
export function generateAdvertising(req) {
  const { client, options, prompt, instructions } = req;
  const d = parseDirectives(instructions);
  const campaign = options.campaignName || req.job?.title || 'Campaign';
  const product = options.product || topicOf(prompt) || client.additional?.productInfo || client.name;
  const cta = options.cta || 'Learn more';
  const audience = options.audience || client.additional?.targetAudience || 'your audience';
  const types = options.outputTypes?.length ? options.outputTypes : ['headlines', 'social', 'cta'];
  const short = options.length === 'short';
  let n = 0;
  const s = (label, text) => ({ id: `s${(n += 1)}`, label, text: applyDirectives(text, { prefix: null, append: null }) });
  const sections = [];

  if (types.includes('headlines')) {
    sections.push(s('Headline 1', `${titleCase(campaign)} — ${short ? 'now on' : 'it starts here'}`));
    sections.push(s('Headline 2', `${titleCase(product.split(' ').slice(0, 4).join(' '))}, done right`));
    if (!short) sections.push(s('Headline 3', `Made for ${audience.split(',')[0].toLowerCase()}`));
  }
  if (types.includes('social')) {
    sections.push(s('Social — Primary text', `${titleCase(product)} from ${client.name}. ${options.objective === 'Event attendance' ? 'Save the date and bring a friend.' : 'Discover what makes it different.'}`));
    if (!short) sections.push(s('Social — Description', `${client.business?.website || client.name} · ${options.tone || client.writingPreferences?.tone || 'Professional'} tone for ${options.platform || 'social'}`));
  }
  if (types.includes('search')) {
    sections.push(s('Search — Headline 1', `${client.name}`.slice(0, 30)));
    sections.push(s('Search — Headline 2', `${titleCase(product)}`.slice(0, 30)));
    sections.push(s('Search — Headline 3', `${cta}`.slice(0, 30)));
    sections.push(s('Search — Description 1', `${titleCase(product)} for ${audience.split(',')[0].toLowerCase()}. ${cta} today.`.slice(0, 90)));
    sections.push(s('Search — Description 2', `${client.description || client.name}`.slice(0, 90)));
  }
  if (types.includes('promo')) {
    sections.push(s('Promotional campaign', `${titleCase(campaign)}: ${product}. ${options.objective ? `Goal: ${options.objective.toLowerCase()}.` : ''} ${cta} with ${client.name}.`.trim()));
  }
  if (types.includes('short')) {
    sections.push(s('Short description', `${titleCase(product)} — by ${client.name}.`));
  }
  if (types.includes('cta')) {
    sections.push(s('Call to action', cta));
  }
  if (options.instructions) sections.push(s('Notes applied', options.instructions));
  if (client.approvedTerms?.disclaimers) sections.push(s('Disclaimer', client.approvedTerms.disclaimers));
  if (d.append) sections.push(s('Required line', d.append));
  if (d.prefix) sections.unshift(s('Opening line', d.prefix));

  return {
    outputs: [{ kind: 'text', title: `${campaign} — ${AD_OUTPUT_TYPES.filter((t) => types.includes(t.id)).map((t) => t.label.toLowerCase()).join(', ')}`.slice(0, 80), sections, content: '' }],
    reply: `Generated ${sections.length} copy sections for ${options.platform || 'your campaign'}. Each section can be copied or edited on its own.`,
  };
}

// ── Vehicles ─────────────────────────────────────────────────────────────
const VEHICLE_FIELDS = [
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

export function generateVehicle(req) {
  const { client, options: v, instructions } = req;
  const d = parseDirectives(instructions);
  const missing = VEHICLE_FIELDS.filter(([k]) => k !== 'warranty' && !String(v[k] || '').trim()).map(([, label]) => label);
  const name = [v.year, v.make, v.model, v.variant].filter(Boolean).join(' ') || 'Vehicle';
  const features = (v.features || []).map((f) => f.trim()).filter(Boolean);
  const facts = [
    v.colour && `finished in ${v.colour}`,
    v.mileage && `showing ${Number(String(v.mileage).replace(/\D/g, '')).toLocaleString('en-AU')} km`,
    v.ownership && v.ownership.toLowerCase(),
    v.serviceHistory && `with ${v.serviceHistory.toLowerCase()}`,
  ].filter(Boolean);
  const headlineBits = [v.ownership && /one|single|1/i.test(v.ownership) ? 'One Owner' : null, v.serviceHistory && /full/i.test(v.serviceHistory) ? 'Full Service History' : null].filter(Boolean);

  const warrantyText = v.warranty?.trim() || client.approvedTerms?.warranty || '';
  if (!warrantyText) missing.push('Warranty details (no client warranty wording on file)');

  const lines = [];
  lines.push(`${name}${headlineBits.length ? ` — ${headlineBits.join(', ')}` : ''}`);
  lines.push('');
  lines.push(`${v.condition && v.condition !== 'New' ? `This ${v.condition.replace('Used — ', '').toLowerCase()}-condition` : 'This'} ${name}${facts.length ? ` is ${facts.join(', ')}` : ''}.`);
  const specList = [v.fuelType && `${v.fuelType} engine`, v.transmission && `${v.transmission} transmission`, ...features];
  if (specList.length) {
    lines.push('');
    lines.push('Key features');
    specList.forEach((f) => lines.push(`• ${f}`));
  }
  if (warrantyText) {
    lines.push('');
    lines.push(warrantyText);
  }
  if (client.approvedTerms?.disclaimers) {
    lines.push('');
    lines.push(client.approvedTerms.disclaimers);
  }
  if (v.instructions) {
    lines.push('');
    lines.push(v.instructions);
  }
  lines.push('');
  lines.push(`${d.signOff || `Contact ${client.business?.businessName || client.name}`}${client.business?.phone ? ` on ${client.business.phone}` : ''} to arrange a test drive.`);
  if (v.stockRef) lines.push(`Stock ref: ${v.stockRef}`);

  return {
    outputs: [{ kind: 'text', title: `${name} listing`, content: applyDirectives(lines.join('\n'), d), missing }],
    reply: missing.length
      ? `Listing generated from the supplied details only. ${missing.length} item${missing.length > 1 ? 's were' : ' was'} not supplied and ${missing.length > 1 ? 'have' : 'has'} been left out — see “Missing information”.`
      : 'Listing generated from the supplied details.',
  };
}

export const GENERATORS = {
  writing: generateWriting,
  image: generateImages,
  advertising: generateAdvertising,
  vehicle: generateVehicle,
};
