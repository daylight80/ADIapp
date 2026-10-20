import { formatDate, formatDateTime, parseBritishDate, dayToBritish, todayDayKey } from '../dateFormat';

describe('formatDate', () => {
  it('writes day-month-year with hyphens and leading zeros', () => {
    expect(formatDate(new Date(2026, 9, 9))).toBe('09-10-2026');
    expect(formatDate(new Date(2026, 0, 5))).toBe('05-01-2026');
  });

  it('reads a plain YYYY-MM-DD day as that day, whatever the timezone', () => {
    expect(formatDate('2026-10-09')).toBe('09-10-2026');
    expect(formatDate('2026-12-31')).toBe('31-12-2026');
  });

  it('reads timestamps and ISO strings in local time', () => {
    const iso = new Date(2026, 9, 9, 23, 30).toISOString();
    expect(formatDate(iso)).toBe('09-10-2026');
    expect(formatDate(new Date(2026, 9, 9, 23, 30).getTime())).toBe('09-10-2026');
  });

  it('is empty for nothing or nonsense', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDate('not a date')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('adds a 24-hour time', () => {
    expect(formatDateTime(new Date(2026, 9, 9, 14, 5))).toBe('09-10-2026 14:05');
    expect(formatDateTime(new Date(2026, 9, 9, 0, 0))).toBe('09-10-2026 00:00');
    expect(formatDateTime('nope')).toBe('');
  });
});

describe('parseBritishDate', () => {
  it('reads DD-MM-YYYY and the usual separators', () => {
    expect(parseBritishDate('09-10-2026')).toBe('2026-10-09');
    expect(parseBritishDate('9/10/2026')).toBe('2026-10-09');
    expect(parseBritishDate(' 09.10.2026 ')).toBe('2026-10-09');
  });
  it('refuses a date that does not exist', () => {
    expect(parseBritishDate('31-02-2026')).toBeNull();
    expect(parseBritishDate('00-10-2026')).toBeNull();
    expect(parseBritishDate('09-13-2026')).toBeNull();
    expect(parseBritishDate('29-02-2027')).toBeNull();
    expect(parseBritishDate('29-02-2028')).toBe('2028-02-29');
  });
  it('refuses American order read wrongly, two-digit years, and other formats', () => {
    expect(parseBritishDate('2026-10-09')).toBeNull();
    expect(parseBritishDate('09-10-26')).toBeNull();
    expect(parseBritishDate('')).toBeNull();
    expect(parseBritishDate(null)).toBeNull();
  });
});

describe('dayToBritish / todayDayKey', () => {
  it('shows a stored day the British way', () => {
    expect(dayToBritish('2026-10-09')).toBe('09-10-2026');
    expect(dayToBritish('')).toBe('');
    expect(dayToBritish('09-10-2026')).toBe('');
  });
  it('gives today as a day key', () => {
    expect(todayDayKey(new Date(2026, 9, 9, 23, 59))).toBe('2026-10-09');
  });
});
