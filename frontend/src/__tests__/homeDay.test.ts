import { greetingFor, firstNameOf, fmtMinutes, gapsBetween, dayTotals } from '../homeDay';

const L = (start_time: string, end_time: string, status = 'Scheduled') => ({ start_time, end_time, status });

describe('homeDay', () => {
  it('greets by time of day', () => {
    expect([greetingFor(0), greetingFor(11), greetingFor(12), greetingFor(16), greetingFor(17), greetingFor(23)])
      .toEqual(['Morning', 'Morning', 'Afternoon', 'Afternoon', 'Evening', 'Evening']);
  });

  it('takes the first name, with a fallback', () => {
    expect(firstNameOf('Sam Okafor')).toBe('Sam');
    expect(firstNameOf('  Sam ')).toBe('Sam');
    expect(firstNameOf('')).toBe('there');
    expect(firstNameOf(undefined)).toBe('there');
  });

  it('formats minutes', () => {
    expect([fmtMinutes(20), fmtMinutes(60), fmtMinutes(65), fmtMinutes(120)]).toEqual(['20 min', '1 h', '1 h 05', '2 h']);
  });

  it('measures and tags the gaps, skipping cancelled lessons and overlaps', () => {
    const day = [L('09:00', '10:00'), L('10:10', '11:00'), L('11:00', '12:00', 'Cancelled'), L('12:00', '13:00'), L('12:30', '13:30'), L('14:15', '15:00')];
    const gaps = gapsBetween(day).map((g) => [g.after.start_time, g.minutes, g.tag]);
    expect(gaps).toEqual([['09:00', 10, 'Tight'], ['10:10', 60, 'Free time'], ['12:30', 45, 'Free time']]);
    // 12:00-13:00 then 12:30 overlaps (-30): no gap line for it.
  });

  it('adds up the day', () => {
    expect(dayTotals([L('09:00', '10:00'), L('10:20', '11:20'), L('12:00', '13:00', 'Cancelled')]))
      .toEqual({ teachMin: 120, lessonCount: 2, gapMin: 20 });
    expect(dayTotals([])).toEqual({ teachMin: 0, lessonCount: 0, gapMin: 0 });
  });
});
