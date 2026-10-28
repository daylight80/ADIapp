import { MAX_LEVEL } from './competencyLevels';

/** Prepaid hours still to use across all of a pupil's block bookings, never below zero. */
export function prepaidHoursLeft(bookings: { hours_paid: number; hours_used: number }[]): number {
  return Math.max(0, bookings.reduce((sum, b) => sum + (b.hours_paid - b.hours_used), 0));
}

/** 1.5 -> "1.5 h", 3 -> "3 h". */
export function fmtHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/** The pupil's driving test date as "6 Nov", or null when none is set or it is not a real date. */
export function testDateLabel(testDate: string | null | undefined): string | null {
  if (!testDate) return null;
  const d = new Date(`${testDate.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** A skill bar: the level out of MAX_LEVEL, as a width, and whether it still needs work (below level 3). */
export function skillBar(level: number): { widthPct: number; needsWork: boolean } {
  const l = Math.min(MAX_LEVEL, Math.max(0, level || 0));
  return { widthPct: (l / MAX_LEVEL) * 100, needsWork: l < 3 };
}
