import {
  parseBankHolidays, holidayOn, shortLabel, holidayBanner, isDivision, DEFAULT_DIVISION, DIVISIONS,
} from '../bankHolidays';

const feed = {
  'england-and-wales': { division: 'england-and-wales', events: [
    { title: 'Christmas Day', date: '2026-12-25', notes: '', bunting: true },
    { title: 'Easter Monday', date: '2027-03-29', notes: '', bunting: true },
  ] },
  scotland: { division: 'scotland', events: [
    { title: '2nd January', date: '2027-01-02', notes: '', bunting: true },
  ] },
  'northern-ireland': { division: 'northern-ireland', events: [
    { title: 'Battle of the Boyne (Orangemen’s Day)', date: '2027-07-12', notes: '', bunting: true },
  ] },
};

describe('parseBankHolidays', () => {
  it('builds a date lookup for each region', () => {
    const p = parseBankHolidays(feed);
    expect(p['england-and-wales']).toEqual({ '2026-12-25': 'Christmas Day', '2027-03-29': 'Easter Monday' });
    expect(p.scotland).toEqual({ '2027-01-02': '2nd January' });
    expect(Object.keys(p)).toHaveLength(3);
  });

  it('keeps regions apart: a Scottish holiday is not an English one', () => {
    const p = parseBankHolidays(feed);
    expect(holidayOn(p.scotland, '2027-01-02')).toBe('2nd January');
    expect(holidayOn(p['england-and-wales'], '2027-01-02')).toBeNull();
  });

  it('skips malformed entries instead of failing', () => {
    const p = parseBankHolidays({
      scotland: { events: [{ title: 'Good', date: '2027-01-02' }, { title: 'No date' }, { date: '2027-01-03' }, { title: 'Bad date', date: '3 Jan 2027' }, null] },
      'england-and-wales': { events: 'nope' },
    });
    expect(p.scotland).toEqual({ '2027-01-02': 'Good' });
    expect(p['england-and-wales']).toBeUndefined();
  });

  it.each([null, undefined, 'text', 42, [], {}])('returns an empty feed for %p', (bad) => {
    expect(parseBankHolidays(bad)).toEqual({});
  });
});

describe('holidayOn', () => {
  it('finds a holiday, and returns null for an ordinary day or no data', () => {
    const map = { '2026-12-25': 'Christmas Day' };
    expect(holidayOn(map, '2026-12-25')).toBe('Christmas Day');
    expect(holidayOn(map, '2026-12-24')).toBeNull();
    expect(holidayOn(undefined, '2026-12-25')).toBeNull();
    expect(holidayOn(map, '')).toBeNull();
  });
});

describe('labels', () => {
  it('uses a short name as it is and "Bank hol" for a long one', () => {
    expect(shortLabel('Good Friday')).toBe('Bank hol');
    expect(shortLabel('New Year')).toBe('New Year');
  });
  it('words the banner and warning', () => {
    expect(holidayBanner('Christmas Day')).toBe('Bank holiday: Christmas Day');
  });
});

describe('regions', () => {
  it('knows the three regions and defaults to England & Wales', () => {
    expect(DIVISIONS.map((d) => d.value)).toEqual(['england-and-wales', 'scotland', 'northern-ireland']);
    expect(DEFAULT_DIVISION).toBe('england-and-wales');
    expect(isDivision('scotland')).toBe(true);
    expect(isDivision('wales')).toBe(false);
    expect(isDivision(null)).toBe(false);
  });
});
