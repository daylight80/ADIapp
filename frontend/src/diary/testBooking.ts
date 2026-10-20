import { toMin, minutesToTime } from './dateUtils';

export const PRACTICAL_TEST = 'Practical Test';

/** Lengths offered for the lesson before a test, in minutes. */
export const PRE_TEST_LENGTHS = [60, 90, 120] as const;
export const DEFAULT_PRE_TEST_MINUTES = 60;

export const isPracticalTest = (lessonType: string | null | undefined): boolean => lessonType === PRACTICAL_TEST;

/**
 * The lesson before a test: it ends when the test starts, so the drive to the centre is part of the lesson.
 * Null when the lesson would have to start before midnight.
 */
export function preTestLesson(testStart: string, minutes: number): { start: string; end: string } | null {
  const end = toMin(testStart);
  const start = end - minutes;
  if (minutes <= 0 || start < 0) return null;
  return { start: minutesToTime(start), end: minutesToTime(end) };
}

/** The pre-test lengths that fit before this test start. */
export function fittingPreTestLengths(testStart: string): number[] {
  return (PRE_TEST_LENGTHS as readonly number[]).filter((m) => preTestLesson(testStart, m) != null);
}

/** The first existing lesson (not cancelled) on that date that overlaps the new time, for a gentle warning. */
export function overlappingLesson<T extends { date: string; start_time: string; end_time: string; status?: string }>(
  lessons: T[], date: string, start: string, end: string,
): T | undefined {
  const s = toMin(start);
  const e = toMin(end);
  return lessons.find((l) => l.date === date && l.status !== 'Cancelled' && toMin(l.start_time) < e && toMin(l.end_time) > s);
}

/** What goes on the pupil's record as the test date: the date at noon, so a timezone shift cannot move it a day. */
export function testDateIso(date: string): string {
  return new Date(`${date}T12:00:00`).toISOString();
}
