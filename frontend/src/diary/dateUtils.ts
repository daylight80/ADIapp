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

/** First day of the calendar month containing d, time zeroed. */
export function startOfMonth(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), 1);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** The Monday on/before the 1st of the month — start of a clean 6-row grid. */
export function startOfMonthGrid(d: Date): Date {
  return startOfWeek(startOfMonth(d));
}

/** Always 42 days (6 full weeks) so the grid height never jumps between
 * months — some months only need 5 rows, but a fixed 6 keeps the layout
 * stable as the user pages back and forth. */
export function endOfMonthGrid(d: Date): Date {
  return addDays(startOfMonthGrid(d), 42);
}

export function addMonths(d: Date, n: number): Date {
  const c = new Date(d);
  c.setMonth(c.getMonth() + n);
  return c;
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** YYYY-MM-DD key for a Date in the local TZ (matches Supabase lesson.date). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
