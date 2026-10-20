// One place for how a full date is written in the app: British day-month-year with hyphens, 09-10-2026.
// (Short calendar labels such as "Tue 21 Oct" in the diary are kept as they are.)

const pad = (n: number) => String(n).padStart(2, '0');

/** Read a Date, a timestamp, an ISO string, or a plain YYYY-MM-DD day. A plain day is taken as that local day, never shifted by timezone. */
function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input == null || input === '') return null;
  let d: Date;
  if (input instanceof Date) d = input;
  else if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, day] = input.split('-').map(Number);
    d = new Date(y, m - 1, day, 12, 0, 0, 0);
  } else d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 09-10-2026. Empty text when there is no valid date. */
export function formatDate(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  return d ? `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}` : '';
}

/** 09-10-2026 14:30 (24-hour). */
export function formatDateTime(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  return d ? `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

/** Today as YYYY-MM-DD (local), for comparing with picked days. */
export function todayDayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * What someone typed as a date, to YYYY-MM-DD, or null when it is not a real date.
 * Accepts DD-MM-YYYY, DD/MM/YYYY and DD.MM.YYYY (and one-digit days and months). A two-digit year is not accepted.
 */
export function parseBritishDate(text: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$/.exec(text || '');
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** A YYYY-MM-DD day as DD-MM-YYYY for an input box (empty if it isn't a day). */
export function dayToBritish(day: string | null | undefined): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? formatDate(day) : '';
}
