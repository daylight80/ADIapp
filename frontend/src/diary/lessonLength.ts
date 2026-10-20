import { toMin, minutesToTime } from './dateUtils';

/** Usual lesson lengths, in minutes, offered as one-tap choices when adding a lesson. */
export const LESSON_LENGTHS = [60, 90, 120, 180] as const;

/** The longest a lesson can run and still end the same day. */
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/** "1 hr", "1½ hrs", "2 hrs": the label on a length chip. */
export function lengthLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const half = minutes % 60 === 30;
  if (minutes % 60 !== 0 && !half) return `${minutes} min`;
  const text = half ? `${h > 0 ? h : ''}½` : String(h);
  return `${text} ${minutes <= 60 ? 'hr' : 'hrs'}`;
}

/** The end time for a lesson starting at `start` and running `minutes`. Stops at 23:59 so a lesson never runs past midnight. */
export function endTimeFor(start: string, minutes: number): string {
  return minutesToTime(Math.min(toMin(start) + Math.max(0, minutes), LAST_MINUTE_OF_DAY));
}

/** How long a lesson from `start` to `end` runs, in minutes (0 if the end is not after the start). */
export function lengthBetween(start: string, end: string): number {
  return Math.max(0, toMin(end) - toMin(start));
}

/** The length chip a start/end pair matches, or null when it is a custom length. */
export function matchingLength(start: string, end: string): number | null {
  const m = lengthBetween(start, end);
  return (LESSON_LENGTHS as readonly number[]).includes(m) ? m : null;
}

/** The end time to use when the start moves: keeps the lesson's current length (2 hours if it has none yet). */
export function endAfterStartChange(newStart: string, oldStart: string, oldEnd: string): string {
  const len = lengthBetween(oldStart, oldEnd) || 120;
  return endTimeFor(newStart, len);
}
