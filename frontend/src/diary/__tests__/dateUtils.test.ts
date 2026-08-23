import {
  startOfWeek, addDays, formatDateRange, toMin, minutesToTime, snapMinutes,
  localDateKey, startOfMonth, startOfMonthGrid, endOfMonthGrid, addMonths, isSameMonth,
} from '../dateUtils';

describe('startOfWeek', () => {
  it('returns the same date when given a Monday', () => {
    const monday = new Date(2026, 7, 24); // Mon 24 Aug 2026
    const result = startOfWeek(monday);
    expect(result.getDate()).toBe(24);
    expect(result.getDay()).toBe(1);
  });

  it('rolls back to Monday from a Wednesday', () => {
    const wednesday = new Date(2026, 7, 26); // Wed 26 Aug 2026
    const result = startOfWeek(wednesday);
    expect(result.getDate()).toBe(24);
  });

  it('rolls back to Monday from a Sunday (the trickiest case — JS getDay()=0)', () => {
    const sunday = new Date(2026, 7, 30); // Sun 30 Aug 2026
    const result = startOfWeek(sunday);
    expect(result.getDate()).toBe(24);
    expect(result.getDay()).toBe(1);
  });

  it('zeroes the time component', () => {
    const d = new Date(2026, 7, 26, 14, 37, 22);
    const result = startOfWeek(d);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it('does not mutate the input date', () => {
    const original = new Date(2026, 7, 26);
    const originalTime = original.getTime();
    startOfWeek(original);
    expect(original.getTime()).toBe(originalTime);
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    const d = new Date(2026, 7, 24);
    expect(addDays(d, 3).getDate()).toBe(27);
  });

  it('subtracts with negative days', () => {
    const d = new Date(2026, 7, 24);
    expect(addDays(d, -3).getDate()).toBe(21);
  });

  it('rolls over a month boundary', () => {
    const d = new Date(2026, 7, 30); // 30 Aug
    const result = addDays(d, 5);
    expect(result.getMonth()).toBe(8); // September (0-indexed)
    expect(result.getDate()).toBe(4);
  });

  it('does not mutate the input date', () => {
    const original = new Date(2026, 7, 24);
    const originalTime = original.getTime();
    addDays(original, 10);
    expect(original.getTime()).toBe(originalTime);
  });
});

describe('formatDateRange', () => {
  it('formats a Monday-start week as "start - end"', () => {
    const monday = new Date(2026, 7, 24);
    expect(formatDateRange(monday)).toBe('24 Aug - 30 Aug');
  });
});

describe('toMin / minutesToTime round trip', () => {
  it('converts HH:MM to minutes correctly', () => {
    expect(toMin('09:30')).toBe(570);
    expect(toMin('00:00')).toBe(0);
    expect(toMin('23:59')).toBe(1439);
  });

  it('returns 0 for malformed input rather than throwing', () => {
    expect(toMin('')).toBe(0);
    expect(toMin('garbage')).toBe(0);
  });

  it('round-trips cleanly', () => {
    expect(minutesToTime(toMin('14:05'))).toBe('14:05');
    expect(minutesToTime(toMin('00:00'))).toBe('00:00');
  });

  it('wraps negative minutes into a valid time rather than producing "-1:xx"', () => {
    expect(minutesToTime(-30)).toBe('23:30');
  });

  it('wraps minutes past 24h back into a valid time', () => {
    expect(minutesToTime(1440 + 30)).toBe('00:30');
  });
});

describe('snapMinutes', () => {
  it('rounds to the nearest 5 by default', () => {
    expect(snapMinutes(122)).toBe(120);
    expect(snapMinutes(123)).toBe(125);
  });

  it('supports a custom step', () => {
    expect(snapMinutes(47, 15)).toBe(45);
    expect(snapMinutes(52, 15)).toBe(45);
    expect(snapMinutes(58, 15)).toBe(60);
  });
});

describe('localDateKey', () => {
  it('formats as YYYY-MM-DD with zero-padding', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 11, 25))).toBe('2026-12-25');
  });
});

describe('month grid helpers', () => {
  it('startOfMonth returns the 1st with time zeroed', () => {
    const d = new Date(2026, 7, 19, 15, 30);
    const result = startOfMonth(d);
    expect(result.getDate()).toBe(1);
    expect(result.getMonth()).toBe(7);
    expect(result.getHours()).toBe(0);
  });

  it('startOfMonthGrid lands on a Monday for a month starting mid-week', () => {
    // August 2026 starts on a Saturday — grid should roll back to the
    // preceding Monday (27 July).
    const d = new Date(2026, 7, 19);
    const gridStart = startOfMonthGrid(d);
    expect(gridStart.getDay()).toBe(1);
    expect(gridStart.getMonth()).toBe(6); // July
    expect(gridStart.getDate()).toBe(27);
  });

  it('startOfMonthGrid stays on the 1st when the month already starts on a Monday', () => {
    // June 2026 starts on a Monday.
    const d = new Date(2026, 5, 15);
    const gridStart = startOfMonthGrid(d);
    expect(gridStart.getDay()).toBe(1);
    expect(gridStart.getDate()).toBe(1);
    expect(gridStart.getMonth()).toBe(5);
  });

  it('endOfMonthGrid is always exactly 42 days after the grid start', () => {
    const d = new Date(2026, 7, 19);
    const gridStart = startOfMonthGrid(d);
    const gridEnd = endOfMonthGrid(d);
    const diffDays = (gridEnd.getTime() - gridStart.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(42);
  });

  it('the 42-day grid fully contains every day of the actual month', () => {
    const d = new Date(2026, 1, 10); // February 2026 (28 days, a good edge case)
    const gridStart = startOfMonthGrid(d);
    const gridEnd = endOfMonthGrid(d);
    const monthStart = startOfMonth(d);
    const lastDayOfMonth = new Date(2026, 2, 0); // last day of Feb
    expect(gridStart.getTime()).toBeLessThanOrEqual(monthStart.getTime());
    expect(gridEnd.getTime()).toBeGreaterThan(lastDayOfMonth.getTime());
  });
});

describe('addMonths', () => {
  it('adds months forward, including a year rollover', () => {
    const d = new Date(2026, 10, 15); // Nov 2026
    const result = addMonths(d, 2);
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(0); // January
  });

  it('subtracts months with a negative value', () => {
    const d = new Date(2026, 1, 15); // Feb 2026
    const result = addMonths(d, -2);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(11); // December
  });
});

describe('isSameMonth', () => {
  it('returns true for two dates in the same month and year', () => {
    expect(isSameMonth(new Date(2026, 7, 1), new Date(2026, 7, 31))).toBe(true);
  });

  it('returns false across a month boundary', () => {
    expect(isSameMonth(new Date(2026, 7, 31), new Date(2026, 8, 1))).toBe(false);
  });

  it('returns false for the same month in different years', () => {
    expect(isSameMonth(new Date(2025, 7, 15), new Date(2026, 7, 15))).toBe(false);
  });
});
