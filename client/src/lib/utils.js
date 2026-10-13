import { clsx } from 'clsx';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

export function cn(...inputs) {
  return clsx(inputs);
}

let counter = 0;
/** Stable, sortable, collision-resistant demo id: prefix_time36rand */
export function createId(prefix = 'id') {
  counter = (counter + 1) % 1296;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${time}${counter.toString(36).padStart(2, '0')}${rand}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value = '') {
  return value
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : parseISO(value);
  return isValid(d) ? d : null;
}

export function formatDate(value, pattern = 'd MMM yyyy') {
  const d = toDate(value);
  return d ? format(d, pattern) : '—';
}

export function formatDateTime(value) {
  return formatDate(value, 'd MMM yyyy, HH:mm');
}

export function timeAgo(value) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 45 * 1000) return 'just now';
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

export function aspectRatio(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!w || !h) return '—';
  const g = gcd(w, h);
  const rw = w / g;
  const rh = h / g;
  if (rw > 50 || rh > 50) return `${(w / h).toFixed(2)}:1`;
  return `${rw}:${rh}`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function truncate(text = '', length = 120) {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  }
}

/** Triggers a real browser download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename) {
  const name = filename.endsWith('.txt') ? filename : `${filename}.txt`;
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name);
}

export function safeFilename(name = 'file') {
  return name.replace(/[^\w\s.-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'file';
}

export function matches(haystack, needle) {
  if (!needle) return true;
  return (haystack || '').toString().toLowerCase().includes(needle.toLowerCase());
}

/** Returns a short excerpt around the first match of `query` in `text`. */
export function excerpt(text = '', query = '', radius = 60) {
  if (!text) return '';
  const idx = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx < 0) return truncate(text, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function sortBy(list, key, dir = 'desc') {
  const mult = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const av = typeof key === 'function' ? key(a) : a[key];
    const bv = typeof key === 'function' ? key(b) : b[key];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * mult;
    return (av > bv ? 1 : av < bv ? -1 : 0) * mult;
  });
}

export function inDateRange(value, range) {
  if (!range || range === 'all') return true;
  const d = toDate(value);
  if (!d) return false;
  const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }[range];
  if (!days) return true;
  return Date.now() - d.getTime() <= days * 86400000;
}
