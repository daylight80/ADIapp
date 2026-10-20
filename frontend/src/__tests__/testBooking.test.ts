import {
  isPracticalTest, defaultTestTimes, shiftTestTimes, testTimesProblem, testStartIso, testSummary, testDateIso,
} from '../diary/testBooking';

describe('Practical Test booking helpers', () => {
  it('knows the Practical Test type', () => {
    expect(isPracticalTest('Practical Test')).toBe(true);
    expect(isPracticalTest('Standard')).toBe(false);
    expect(isPracticalTest(undefined)).toBe(false);
  });

  it('suggests an hour of lesson, then the test, then an hour to finish', () => {
    expect(defaultTestTimes('11:00')).toEqual({ testTime: '12:00', end: '13:00' });
    expect(defaultTestTimes('09:30')).toEqual({ testTime: '10:30', end: '11:30' });
  });

  it('never runs past the end of the day', () => {
    expect(defaultTestTimes('23:00')).toEqual({ testTime: '23:59', end: '23:59' });
  });

  it('moves the test time and the end when the start moves, keeping the gaps', () => {
    expect(shiftTestTimes('13:00', '11:00', '12:00', '13:15')).toEqual({ testTime: '14:00', end: '15:15' });
    expect(shiftTestTimes('09:00', '11:00', '12:00', '13:00')).toEqual({ testTime: '10:00', end: '11:00' });
  });

  it('checks start, test time and end make sense together', () => {
    expect(testTimesProblem('11:00', '12:00', '13:00')).toBeNull();
    expect(testTimesProblem('11:00', '11:00', '13:00')).toBeNull(); // test right at the start is allowed
    expect(testTimesProblem('11:00', '', '13:00')).toMatch(/time the test starts/);
    expect(testTimesProblem('11:00', '10:30', '13:00')).toMatch(/before the lesson/);
    expect(testTimesProblem('11:00', '13:00', '13:00')).toMatch(/before the lesson ends/);
    expect(testTimesProblem('11:00', '12:00', '11:00')).toMatch(/end after it starts/);
  });

  it('builds the test timestamp on the lesson day', () => {
    const iso = testStartIso('2026-11-05', '12:00');
    expect(new Date(iso as string).getHours()).toBe(12);
    expect(new Date(iso as string).getDate()).toBe(5);
    expect(testStartIso('', '12:00')).toBeNull();
    expect(testStartIso('2026-11-05', '')).toBeNull();
  });

  it('summarises the test for a card', () => {
    expect(testSummary('13:30', 'Morden Driving Test Centre')).toBe('Test at 13:30 · Morden Driving Test Centre');
    expect(testSummary('13:30', '')).toBe('Test at 13:30');
    expect(testSummary(null, ' Morden ')).toBe('Morden');
    expect(testSummary(null, null)).toBe('');
  });

  it('stores the test date at midday so it cannot slip a day', () => {
    expect(new Date(testDateIso('2026-10-21')).getHours()).toBe(12);
  });
});
