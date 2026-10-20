import { differenceInCalendarDays, format, isSameMonth, isSameYear, isToday, isYesterday } from 'date-fns';

/**
 * Chat-history date helpers. All grouping and ranges use the viewer's own
 * timezone, so "Tuesday" means their Tuesday.
 */

/** Sidebar grouping: Today · Yesterday · Previous 7 days · Earlier this month · "September 2026" … */
export function groupByRecency(items, getDate = (c) => c.lastActivityAt || c.updatedAt) {
  const now = new Date();
  const groups = new Map();
  for (const item of items) {
    const d = new Date(getDate(item));
    let label;
    if (isToday(d)) label = 'Today';
    else if (isYesterday(d)) label = 'Yesterday';
    else if (differenceInCalendarDays(now, d) <= 7) label = 'Previous 7 days';
    else if (isSameMonth(now, d)) label = 'Earlier this month';
    else label = format(d, isSameYear(now, d) ? 'MMMM' : 'MMMM yyyy');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  return [...groups].map(([label, list]) => ({ label, items: list }));
}

/** Full-history grouping by calendar day: "Today", "Yesterday", "Monday 19 October 2026". */
export function groupByDay(items, getDate = (c) => c.lastActivityAt || c.updatedAt) {
  const groups = new Map();
  for (const item of items) {
    const d = new Date(getDate(item));
    const key = format(d, 'yyyy-MM-dd');
    const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE d MMMM yyyy');
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

/** { from, to } ISO instants covering one local calendar day ("2026-10-19"). */
export function dayRange(yyyyMmDd) {
  if (!yyyyMmDd) return {};
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return { from: new Date(y, m - 1, d).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() };
}

/** { from, to } ISO instants covering a local month (month 1–12) or a whole year when month is empty. */
export function monthRange(year, month) {
  if (!year) return {};
  const y = Number(year);
  if (!month) return { from: new Date(y, 0, 1).toISOString(), to: new Date(y + 1, 0, 1).toISOString() };
  const m = Number(month);
  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
}

/** Short time label for a list row: "14:05" today, "Mon" this week, "19 Oct" this year, else "19 Oct 2025". */
export function shortWhen(iso) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, 'EEE HH:mm');
  return format(d, isSameYear(new Date(), d) ? 'd MMM' : 'd MMM yyyy');
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((label, i) => ({
  value: String(i + 1),
  label,
}));

/** This year and the previous four, newest first. */
export function recentYears(count = 5) {
  const y = new Date().getFullYear();
  return Array.from({ length: count }, (_, i) => String(y - i));
}
