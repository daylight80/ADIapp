import { INSTRUCTOR_PROFILE_SECTIONS, visibleSections, type ProfileRowKey } from '../profileSections';

const ALL_ROWS: ProfileRowKey[] = [
  'details', 'school', 'packages', 'vouchers', 'income', 'subscription',
  'syllabuses', 'vehicles', 'noteQuestions',
  'standards', 'deadlines',
  'navApp', 'unavailabilities', 'travelBuffer', 'bankHolidays', 'calendarFeed', 'importContacts',
  'fingerprint', 'privacy',
];

describe('instructor Profile sections', () => {
  const placed = INSTRUCTOR_PROFILE_SECTIONS.flatMap((s) => s.rows);

  it('has the five headings in order, with the account options last', () => {
    expect(INSTRUCTOR_PROFILE_SECTIONS.map((s) => s.title)).toEqual(
      ['My business', 'Teaching', 'Compliance', 'Diary & students', 'Account'],
    );
    expect(INSTRUCTOR_PROFILE_SECTIONS[INSTRUCTOR_PROFILE_SECTIONS.length - 1].rows).toEqual(['fingerprint', 'privacy']);
  });

  it('gives every row exactly one home, so none can be lost or shown twice', () => {
    expect([...placed].sort()).toEqual([...ALL_ROWS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('keeps related rows together: compliance rows sit side by side, business rows come before teaching rows', () => {
    const idx = (k: ProfileRowKey) => placed.indexOf(k);
    expect(Math.abs(idx('standards') - idx('deadlines'))).toBe(1);
    expect(idx('vouchers')).toBeLessThan(idx('syllabuses'));
    expect(idx('privacy')).toBe(placed.length - 1);
  });
});

describe('visibleSections', () => {
  it('keeps the order and skips rows that do not apply', () => {
    const shown = visibleSections(INSTRUCTOR_PROFILE_SECTIONS, (k) => (k === 'school' || k === 'fingerprint' ? null : k));
    const business = shown.find((s) => s.title === 'My business')!;
    expect(business.rows.map((r) => r.key)).toEqual(['details', 'packages', 'vouchers', 'income', 'subscription']);
    expect(shown.find((s) => s.title === 'Account')!.rows.map((r) => r.key)).toEqual(['privacy']);
  });

  it('drops a heading whose rows are all unavailable', () => {
    const shown = visibleSections(INSTRUCTOR_PROFILE_SECTIONS, (k) => (['standards', 'deadlines'].includes(k) ? null : k));
    expect(shown.map((s) => s.title)).not.toContain('Compliance');
    expect(shown).toHaveLength(4);
  });

  it('returns the node built for each row', () => {
    const shown = visibleSections(INSTRUCTOR_PROFILE_SECTIONS, (k) => `row:${k}`);
    expect(shown[0].rows[0]).toEqual({ key: 'details', node: 'row:details' });
  });
});
