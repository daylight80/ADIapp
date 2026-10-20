import { isPracticalTest, preTestLesson, fittingPreTestLengths, overlappingLesson, testDateIso, DEFAULT_PRE_TEST_MINUTES } from '../diary/testBooking';

describe('test booking helpers', () => {
  it('knows the Practical Test type', () => {
    expect(isPracticalTest('Practical Test')).toBe(true);
    expect(isPracticalTest('Standard')).toBe(false);
    expect(isPracticalTest(undefined)).toBe(false);
  });

  it('puts the lesson before the test, ending when the test starts', () => {
    expect(DEFAULT_PRE_TEST_MINUTES).toBe(60);
    expect(preTestLesson('13:30', 60)).toEqual({ start: '12:30', end: '13:30' });
    expect(preTestLesson('08:45', 90)).toEqual({ start: '07:15', end: '08:45' });
  });

  it('refuses a lesson that would start before midnight', () => {
    expect(preTestLesson('00:30', 60)).toBeNull();
    expect(preTestLesson('09:00', 0)).toBeNull();
    expect(fittingPreTestLengths('01:30')).toEqual([60, 90]);
    expect(fittingPreTestLengths('09:00')).toEqual([60, 90, 120]);
  });

  it('finds a lesson that overlaps the new one, ignoring cancelled ones and other days', () => {
    const lessons = [
      { date: '2026-10-21', start_time: '11:00', end_time: '12:30', status: 'Scheduled', id: 'a' },
      { date: '2026-10-21', start_time: '12:00', end_time: '13:00', status: 'Cancelled', id: 'b' },
      { date: '2026-10-22', start_time: '12:00', end_time: '13:00', status: 'Scheduled', id: 'c' },
    ];
    expect(overlappingLesson(lessons, '2026-10-21', '12:00', '13:00')?.id).toBe('a');
    expect(overlappingLesson(lessons, '2026-10-21', '12:30', '13:30')).toBeUndefined(); // starts as the other ends
    expect(overlappingLesson(lessons, '2026-10-23', '12:00', '13:00')).toBeUndefined();
  });

  it('stores the test date at midday so it cannot slip a day', () => {
    expect(new Date(testDateIso('2026-10-21')).getHours()).toBe(12);
  });
});
