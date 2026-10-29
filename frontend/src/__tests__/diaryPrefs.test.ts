import { cleanPrefs, lengthOptions, typesOffered, workHours, suggestedPrice } from '../diary/diaryPrefs';

describe('cleanPrefs', () => {
  it('keeps good values and drops bad ones', () => {
    const p = cleanPrefs({
      lesson_lengths: [{ minutes: 120, price: 70 }, { minutes: 60, price: null }, { minutes: 60 }, { minutes: 5 }, { minutes: 'x' }, { minutes: 90, price: -3 }],
      lesson_types: ['Night', 7, 'Theory'],
      work_start: '09:00', work_end: '17:00',
    });
    expect(p.lesson_lengths).toEqual([{ minutes: 60, price: null }, { minutes: 90, price: null }, { minutes: 120, price: 70 }]);
    expect(p.lesson_types).toEqual(['Night', 'Theory']);
    expect(p.work_start).toBe('09:00');
  });

  it('ignores working hours that run backwards or are not times', () => {
    expect(cleanPrefs({ work_start: '18:00', work_end: '08:00' }).work_start).toBeUndefined();
    expect(cleanPrefs({ work_start: '9am', work_end: '5pm' }).work_start).toBeUndefined();
  });

  it('copes with nothing at all', () => {
    expect(cleanPrefs(null)).toEqual({});
    expect(cleanPrefs('x')).toEqual({});
  });
});

describe('defaults when the instructor has set nothing', () => {
  it('offers 1, 1.5, 2 and 3 hours, every type, and 08:00 to 18:00', () => {
    expect(lengthOptions({}).map((o) => o.minutes)).toEqual([60, 90, 120, 180]);
    expect(typesOffered({}).length).toBe(11);
    expect(workHours({})).toEqual({ start: '08:00', end: '18:00' });
  });

  it('uses the instructor\'s own lengths and types when set', () => {
    expect(lengthOptions({ lesson_lengths: [{ minutes: 45, price: 30 }] }).map((o) => o.minutes)).toEqual([45]);
    expect(typesOffered({ lesson_types: ['Night', 'Theory'] }).map((t) => t.value)).toEqual(['Night', 'Theory']);
  });

  it('keeps the type already chosen on the list, and never shows an empty list', () => {
    expect(typesOffered({ lesson_types: ['Night'] }, 'Standard').map((t) => t.value)).toEqual(['Standard', 'Night']);
    expect(typesOffered({ lesson_types: ['Nonsense'] }).length).toBe(11);
  });
});

describe('suggestedPrice', () => {
  const prefs = { lesson_lengths: [{ minutes: 90, price: 55 }, { minutes: 120, price: null }] };

  it('uses the instructor\'s price for that length', () => {
    expect(suggestedPrice(90, prefs, 40, 40)).toEqual({ price: 55, source: 'length' });
  });

  it('uses the hourly rate times the length when the length has no price', () => {
    expect(suggestedPrice(120, prefs, 40, 40)).toEqual({ price: 80, source: 'pupil' });
    expect(suggestedPrice(60, prefs, null, 38)).toEqual({ price: 38, source: 'default' });
  });

  it('lets a pupil on their own special rate keep it', () => {
    expect(suggestedPrice(90, prefs, 30, 40)).toEqual({ price: 45, source: 'pupil' });
  });

  it('gives nothing when there is nothing to go on', () => {
    expect(suggestedPrice(60, {}, null, null)).toBeNull();
    expect(suggestedPrice(0, prefs, 40, 40)).toBeNull();
  });
});
