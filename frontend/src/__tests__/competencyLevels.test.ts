import { LEVEL_LABELS, MAX_LEVEL, levelLabel } from '../competencyLevels';

describe('competency level names', () => {
  it('has one distinct name for each of the five levels', () => {
    expect(MAX_LEVEL).toBe(5);
    expect(new Set(LEVEL_LABELS).size).toBe(5);
    expect([1, 2, 3, 4, 5].map(levelLabel)).toEqual(['Introduced', 'Practising', 'Developing', 'Confident', 'Mastered']);
  });

  it('only calls level 5 Mastered (level 4 used to read Mastered too)', () => {
    expect(levelLabel(4)).not.toBe(levelLabel(5));
    expect([1, 2, 3, 4, 5].filter((l) => levelLabel(l) === 'Mastered')).toEqual([5]);
  });

  it('keeps out-of-range or odd values inside the scale', () => {
    expect(levelLabel(0)).toBe('Introduced');
    expect(levelLabel(-3)).toBe('Introduced');
    expect(levelLabel(9)).toBe('Mastered');
    expect(levelLabel(NaN)).toBe('Introduced');
    expect(levelLabel(2.6)).toBe('Developing');
  });
});
