// Pupil confidence: after a lesson the pupil rates how confident they felt, 1 to 5. Pure logic, tested in
// __tests__/pupilConfidence.test.ts.
import { mostRecentCompletedLesson, type LessonLike } from './nextLesson';

export const CONFIDENCE_LABELS = ['Not at all', 'A little', 'Fairly', 'Confident', 'Very confident'] as const;
/** Only the latest lesson is asked about, and only for this many days after it, so old lessons never nag. */
export const RATE_WITHIN_DAYS = 7;
/** The instructor's average looks at this many of the latest ratings. */
export const AVERAGE_OVER = 5;

type RateLesson = LessonLike & { pupil_confidence?: number | null };
type RatedLesson = { status?: string | null; date: string; pupil_confidence?: number | null };

/** The lesson to ask the pupil about: their most recent completed one, if unrated and recent. */
export function lessonToRate<T extends RateLesson>(lessons: T[], now: Date = new Date()): T | undefined {
  const last = mostRecentCompletedLesson(lessons);
  if (!last || last.pupil_confidence) return undefined;
  const ageDays = (now.getTime() - new Date(`${last.date}T00:00:00`).getTime()) / 86_400_000;
  return ageDays <= RATE_WITHIN_DAYS ? last : undefined;
}

export type ConfidenceSummary = { latest: number; average: number; count: number };

/** For the instructor: the newest rating and the average of the latest few. Null until the pupil has rated one. */
export function confidenceSummary(lessons: RatedLesson[]): ConfidenceSummary | null {
  const rated = lessons
    .filter((l) => l.status === 'Completed' && !!l.pupil_confidence)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, AVERAGE_OVER);
  if (!rated.length) return null;
  const sum = rated.reduce((n, l) => n + (l.pupil_confidence as number), 0);
  return { latest: rated[0].pupil_confidence as number, average: Math.round((sum / rated.length) * 10) / 10, count: rated.length };
}
