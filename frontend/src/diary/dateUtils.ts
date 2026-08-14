/**
 * Lesson Diary — pure date & time helpers.
 * No React, no styling — easy to unit-test if/when needed.
 */

export function startOfWeek(d: Date): Date {
  const c = new Date(d);
  const day = c.getDay();
  const diff = (day + 6) % 7; // Monday = 0
  c.setDate(c.getDate() - diff);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function formatDateRange(start: Date): string {
  const end = addDays(start, 6);
  const m = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${m(start)} - ${m(end)}`;
}

/** Convert 'HH:MM' to total minutes since midnight. Returns 0 for malformed input. */
export function toMin(hhmm: string): number {
  const [h, m] = (hhmm || '').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Inverse of toMin — total minutes since midnight back to 'HH:MM'. Wraps
 * within a single day (0-1439), which is fine since lessons never span
 * midnight in this app. */
export function minutesToTime(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Round to the nearest `step` minutes — used when dragging a lesson so it
 * lands on a clean time (e.g. 14:05, not 14:03). */
export function snapMinutes(minutes: number, step = 5): number {
  return Math.round(minutes / step) * step;
}

/** YYYY-MM-DD key for a Date in the local TZ (matches Supabase lesson.date). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
