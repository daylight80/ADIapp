// How a lesson block looks in the diary. A completed lesson turns green and says so, so the instructor can see
// at a glance what has been done and what is still to do.
import { colorForLessonType } from './lessonTypes';

export const COMPLETED_GREEN = '#15803D';
export const COMPLETED_NOTE = '\u2713 Lesson Completed';

export function isCompletedLesson(status: string | null | undefined): boolean {
  return status === 'Completed';
}

/** A cancelled lesson is kept in the data but left out of the diary, its totals and its gaps unless asked for. */
export function isCancelledLesson(status: string | null | undefined): boolean {
  return status === 'Cancelled';
}

/** The block's colour: green when completed, otherwise by lesson type. */
export function lessonBlockColor(status: string | null | undefined, lessonType: string | null | undefined): string {
  return isCompletedLesson(status) ? COMPLETED_GREEN : colorForLessonType(lessonType);
}
