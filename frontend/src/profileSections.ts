// How the instructor's Profile screen is grouped. The screen builds each row and
// looks it up here by key, so every row has exactly one home (see
// __tests__/profileSections.test.ts, which fails if a row is dropped or repeated).
//
// Order: the things you set up once come first, the things used while teaching
// next, and account options (including data deletion) last, away from where a
// thumb lands by accident. There is no Sign out row: the bottom bar has Logout.

export type ProfileRowKey =
  | 'details' | 'school' | 'packages' | 'vouchers' | 'income' | 'subscription' | 'websiteForm'
  | 'syllabuses' | 'vehicles' | 'noteQuestions'
  | 'standards' | 'deadlines'
  | 'navApp' | 'unavailabilities' | 'travelBuffer' | 'workingHours' | 'lessonTypes' | 'reminderBalance' | 'bankHolidays' | 'calendarFeed' | 'importContacts'
  | 'fingerprint' | 'privacy';

export type ProfileSection = { title: string; rows: ProfileRowKey[] };

export const INSTRUCTOR_PROFILE_SECTIONS: ProfileSection[] = [
  { title: 'My business', rows: ['details', 'school', 'packages', 'vouchers', 'income', 'subscription', 'websiteForm'] },
  { title: 'Teaching', rows: ['syllabuses', 'vehicles', 'noteQuestions'] },
  { title: 'Compliance', rows: ['standards', 'deadlines'] },
  { title: 'Diary & students', rows: ['navApp', 'unavailabilities', 'travelBuffer', 'workingHours', 'lessonTypes', 'reminderBalance', 'bankHolidays', 'calendarFeed', 'importContacts'] },
  { title: 'Account', rows: ['fingerprint', 'privacy'] },
];

/**
 * Sections to show given which rows are available right now (a row is missing when it
 * does not apply, such as the fingerprint option on a phone without biometrics). A
 * section with no rows left is dropped so no heading is shown with nothing under it.
 */
export function visibleSections<T>(
  sections: ProfileSection[],
  rowFor: (key: ProfileRowKey) => T | null | undefined | false,
): { title: string; rows: { key: ProfileRowKey; node: T }[] }[] {
  return sections
    .map((s) => ({
      title: s.title,
      rows: s.rows.flatMap((key) => {
        const node = rowFor(key);
        return node ? [{ key, node }] : [];
      }),
    }))
    .filter((s) => s.rows.length > 0);
}
