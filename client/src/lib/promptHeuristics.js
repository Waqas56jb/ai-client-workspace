/** Client-side prompt heuristics used for UI hints (the server makes the real decisions). */

/**
 * Demo directives: simple lines in the AI Instructions that visibly change output
 * so editing instructions has an observable effect in demo mode.
 *   Prefix: text   → prepended to the output
 *   Append: text   → appended to the output
 *   Sign-off: text → replaces the sign-off for emails / WhatsApp
 */
export function parseDirectives(instructions) {
  const text = [instructions?.systemInstruction, instructions?.outputRules, instructions?.formatting, instructions?.constraints].filter(Boolean).join('\n');
  const get = (key) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'im'));
    return m ? m[1].trim() : null;
  };
  const rules = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 3);
  return { prefix: get('Prefix'), append: get('Append'), signOff: get('Sign-off'), ruleCount: rules.length };
}

/** Guesses the writing format from the prompt text (UI hint only; the API re-detects). */
export function detectFormat(prompt = '') {
  const p = prompt.toLowerCase();
  if (/\bwhats\s?app\b/.test(p)) return 'whatsapp';
  if (/\b(sms|text message)\b/.test(p)) return 'sms';
  if (/\b(e-?mail|newsletter)\b/.test(p)) return 'email';
  return null;
}
