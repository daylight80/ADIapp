import { toMin, minutesToTime } from './dateUtils';

export const PRACTICAL_TEST = 'Practical Test';

/**
 * A Practical Test booking is one block in the diary: the lesson starts, the test starts part-way through,
 * and the lesson ends after it (the drive home and a debrief). Usual shape: a hour of lesson first, then the
 * test, then an hour to finish.
 */
export const DEFAULT_LESSON_BEFORE_TEST_MIN = 60;
export const DEFAULT_TIME_AFTER_TEST_MIN = 60;

export const isPracticalTest = (lessonType: string | null | undefined): boolean => lessonType === PRACTICAL_TEST;

const LAST_MINUTE_OF_DAY = 23 * 60 + 59;
const clampDay = (min: number) => Math.min(Math.max(min, 0), LAST_MINUTE_OF_DAY);

/** A sensible test time and lesson end for a booking that starts at `start`. */
export function defaultTestTimes(start: string): { testTime: string; end: string } {
  const test = clampDay(toMin(start) + DEFAULT_LESSON_BEFORE_TEST_MIN);
  return { testTime: minutesToTime(test), end: minutesToTime(clampDay(test + DEFAULT_TIME_AFTER_TEST_MIN)) };
}

/** Moving the start moves the test time and the end with it, keeping the same gaps. */
export function shiftTestTimes(newStart: string, oldStart: string, oldTest: string, oldEnd: string): { testTime: string; end: string } {
  const delta = toMin(newStart) - toMin(oldStart);
  return {
    testTime: minutesToTime(clampDay(toMin(oldTest) + delta)),
    end: minutesToTime(clampDay(toMin(oldEnd) + delta)),
  };
}

/** What is wrong with a lesson start / test time / lesson end, in words for the instructor; null when it is fine. */
export function testTimesProblem(start: string, testTime: string, end: string): string | null {
  if (!testTime) return 'Enter the time the test starts.';
  const s = toMin(start);
  const t = toMin(testTime);
  const e = toMin(end);
  if (e <= s) return 'The lesson must end after it starts.';
  if (t < s) return 'The test can’t start before the lesson does.';
  if (t >= e) return 'The test must start before the lesson ends.';
  return null;
}

/** The test time as a timestamp on the lesson's day (local time). */
export function testStartIso(date: string, testTime: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(testTime)) return null;
  const d = new Date(`${date}T${testTime}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "Test at 13:30 · Morden Driving Test Centre", or just the time, or just the centre. */
export function testSummary(testTime?: string | null, centre?: string | null): string {
  const parts = [testTime ? `Test at ${testTime}` : '', centre?.trim() || ''].filter(Boolean);
  return parts.join(' · ');
}

/** What goes on the pupil's record as the test date: the date at noon, so a timezone shift cannot move it a day. */
export function testDateIso(date: string): string {
  return new Date(`${date}T12:00:00`).toISOString();
}
