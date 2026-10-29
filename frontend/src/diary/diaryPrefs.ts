import { LESSON_TYPES } from './lessonTypes';
import { LESSON_LENGTHS } from './lessonLength';

// An instructor's own Add Lesson choices (migration 095): which lengths to offer (each with an optional total price),
// which lesson types to offer, and the hours "next available" may suggest. Anything unset falls back to the app's
// defaults, so an instructor who has set nothing sees exactly what they saw before. Pure logic, unit-tested.

export type LengthOption = { minutes: number; price: number | null };

export type DiaryPrefs = {
  lesson_lengths?: LengthOption[];
  /** The lesson types offered; absent or null means all of them. */
  lesson_types?: string[] | null;
  work_start?: string;
  work_end?: string;
};

export const DEFAULT_WORK_START = '08:00';
export const DEFAULT_WORK_END = '18:00';
/** Lengths an instructor can pick from on Pricing & packages. */
export const LENGTH_CHOICES = [30, 45, 60, 75, 90, 120, 150, 180, 240] as const;
export const MAX_LENGTHS = 8;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whatever came back from the database, reduced to what the app can safely use. */
export function cleanPrefs(raw: unknown): DiaryPrefs {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: DiaryPrefs = {};
  if (Array.isArray(r.lesson_lengths)) {
    const seen = new Set<number>();
    const lengths: LengthOption[] = [];
    for (const e of r.lesson_lengths) {
      const m = Number((e as any)?.minutes);
      if (!Number.isInteger(m) || m < 15 || m > 480 || seen.has(m)) continue;
      seen.add(m);
      const p = (e as any)?.price;
      lengths.push({ minutes: m, price: p != null && Number.isFinite(Number(p)) && Number(p) >= 0 ? Number(p) : null });
    }
    if (lengths.length) out.lesson_lengths = lengths.sort((a, b) => a.minutes - b.minutes).slice(0, MAX_LENGTHS);
  }
  if (Array.isArray(r.lesson_types)) out.lesson_types = r.lesson_types.filter((t): t is string => typeof t === 'string');
  if (typeof r.work_start === 'string' && typeof r.work_end === 'string' && HHMM.test(r.work_start) && HHMM.test(r.work_end) && r.work_start < r.work_end) {
    out.work_start = r.work_start;
    out.work_end = r.work_end;
  }
  return out;
}

/** The length chips to show: the instructor's own, else the usual 1 / 1½ / 2 / 3 hours. */
export function lengthOptions(p: DiaryPrefs | null | undefined): LengthOption[] {
  return p?.lesson_lengths?.length ? p.lesson_lengths : LESSON_LENGTHS.map((minutes) => ({ minutes, price: null }));
}

/** The lesson types to offer. Never empty, and the type already chosen stays on the list so it can still be seen. */
export function typesOffered(p: DiaryPrefs | null | undefined, current?: string) {
  const wanted = p?.lesson_types;
  if (!wanted || wanted.length === 0) return [...LESSON_TYPES];
  const shown = LESSON_TYPES.filter((t) => wanted.includes(t.value) || t.value === current);
  return shown.length ? shown : [...LESSON_TYPES];
}

export function workHours(p: DiaryPrefs | null | undefined): { start: string; end: string } {
  return { start: p?.work_start ?? DEFAULT_WORK_START, end: p?.work_end ?? DEFAULT_WORK_END };
}

export type PriceSource = 'length' | 'pupil' | 'default';

/**
 * The price to suggest for a lesson of `minutes`. The instructor's price for that length wins, unless the pupil is on
 * their own special hourly rate (different from the default): then the pupil's rate times the length is used.
 */
export function suggestedPrice(
  minutes: number,
  p: DiaryPrefs | null | undefined,
  pupilRate: number | null | undefined,
  defaultRate: number | null | undefined,
): { price: number; source: PriceSource } | null {
  if (!(minutes > 0)) return null;
  const set = p?.lesson_lengths?.find((o) => o.minutes === minutes)?.price;
  const hasPupil = typeof pupilRate === 'number' && pupilRate > 0;
  const hasDefault = typeof defaultRate === 'number' && defaultRate > 0;
  const specialRate = hasPupil && hasDefault && Math.abs((pupilRate as number) - (defaultRate as number)) >= 0.005;
  if (set != null && !specialRate) return { price: round2(set), source: 'length' };
  if (hasPupil) return { price: round2((pupilRate as number) * minutes / 60), source: 'pupil' };
  if (hasDefault) return { price: round2((defaultRate as number) * minutes / 60), source: 'default' };
  return null;
}
