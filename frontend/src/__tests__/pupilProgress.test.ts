import { prepaidHoursLeft, fmtHours, testDateLabel, skillBar } from '../pupilProgress';

describe('pupilProgress', () => {
  it('adds up prepaid hours left and never goes below zero', () => {
    expect(prepaidHoursLeft([])).toBe(0);
    expect(prepaidHoursLeft([{ hours_paid: 10, hours_used: 7 }, { hours_paid: 5, hours_used: 5 }])).toBe(3);
    expect(prepaidHoursLeft([{ hours_paid: 2, hours_used: 3 }])).toBe(0);
  });

  it('formats hours', () => {
    expect([fmtHours(3), fmtHours(1.5), fmtHours(0)]).toEqual(['3 h', '1.5 h', '0 h']);
  });

  it('formats the test date, or nothing', () => {
    expect(testDateLabel('2026-11-06')).toBe('6 Nov');
    expect(testDateLabel('2026-11-06T09:30:00Z')).toBe('6 Nov');
    expect(testDateLabel(null)).toBeNull();
    expect(testDateLabel('')).toBeNull();
    expect(testDateLabel('not a date')).toBeNull();
  });

  it('draws skill bars out of 5, and flags below 3', () => {
    expect(skillBar(2)).toEqual({ widthPct: 40, needsWork: true });
    expect(skillBar(3)).toEqual({ widthPct: 60, needsWork: false });
    expect(skillBar(5)).toEqual({ widthPct: 100, needsWork: false });
    expect(skillBar(9).widthPct).toBe(100);
    expect(skillBar(0)).toEqual({ widthPct: 0, needsWork: true });
  });
});
