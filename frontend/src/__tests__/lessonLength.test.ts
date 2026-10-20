import { LESSON_LENGTHS, lengthLabel, endTimeFor, lengthBetween, matchingLength, endAfterStartChange } from '../diary/lessonLength';

describe('lesson length', () => {
  it('offers the usual lengths', () => {
    expect([...LESSON_LENGTHS]).toEqual([60, 90, 120, 180]);
    expect(LESSON_LENGTHS.map(lengthLabel)).toEqual(['1 hr', '1½ hrs', '2 hrs', '3 hrs']);
    expect(lengthLabel(30)).toBe('½ hr');
    expect(lengthLabel(45)).toBe('45 min');
  });

  it('works out the end time from the start and a length', () => {
    expect(endTimeFor('09:00', 60)).toBe('10:00');
    expect(endTimeFor('09:15', 90)).toBe('10:45');
    expect(endTimeFor('14:30', 120)).toBe('16:30');
  });

  it('never runs past midnight', () => {
    expect(endTimeFor('22:30', 180)).toBe('23:59');
  });

  it('measures a lesson and matches it to a length chip', () => {
    expect(lengthBetween('09:00', '11:00')).toBe(120);
    expect(lengthBetween('11:00', '09:00')).toBe(0);
    expect(matchingLength('09:00', '10:30')).toBe(90);
    expect(matchingLength('09:00', '10:45')).toBeNull();
  });

  it('keeps the length when the start moves, so the end follows', () => {
    expect(endAfterStartChange('13:00', '09:00', '10:30')).toBe('14:30');
    // no usable length yet: falls back to 2 hours
    expect(endAfterStartChange('13:00', '09:00', '09:00')).toBe('15:00');
  });
});
