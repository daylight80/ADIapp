// The "No booking" and "Low credit" tiles on the Students screen flag pupils who need
// action before their next lesson. A pupil who has passed, or who is inactive or on the
// waiting list, is not having lessons, so they are not counted. Money owed ("In arrears")
// still counts for everyone, because a debt does not go away when lessons stop.

import { isLowCredit } from './walletDisplay';

const NOT_HAVING_LESSONS = ['Passed', 'Inactive', 'Waitlist'];

type GlanceStudent = { id: string; status?: string | null; next_lesson?: string | null };

export function isHavingLessons(status: string | null | undefined): boolean {
  return !NOT_HAVING_LESSONS.includes(status ?? '');
}

export function needsBooking(s: Pick<GlanceStudent, 'status' | 'next_lesson'>): boolean {
  return isHavingLessons(s.status) && !s.next_lesson;
}

export function hasLowCredit(s: Pick<GlanceStudent, 'id' | 'status'>, hoursBalances: Record<string, number | undefined>): boolean {
  return isHavingLessons(s.status) && isLowCredit(hoursBalances[s.id]);
}
