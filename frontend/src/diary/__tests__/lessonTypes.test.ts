import { LESSON_TYPES, colorForLessonType } from '../lessonTypes';

describe('colorForLessonType', () => {
  it('returns the correct color for a known type', () => {
    expect(colorForLessonType('Theory')).toBe(
      LESSON_TYPES.find((t) => t.value === 'Theory')!.color,
    );
  });

  it('falls back to the Standard color for an unrecognized value', () => {
    const standardColor = LESSON_TYPES.find((t) => t.value === 'Standard')!.color;
    expect(colorForLessonType('SomeLegacyValueThatNoLongerExists')).toBe(standardColor);
  });

  it('falls back to the Standard color for null/undefined (legacy lessons before this field existed)', () => {
    const standardColor = LESSON_TYPES.find((t) => t.value === 'Standard')!.color;
    expect(colorForLessonType(null)).toBe(standardColor);
    expect(colorForLessonType(undefined)).toBe(standardColor);
  });
});

describe('LESSON_TYPES', () => {
  it('has no duplicate values', () => {
    const values = LESSON_TYPES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('has no duplicate colors — every type should be visually distinguishable', () => {
    const colors = LESSON_TYPES.map((t) => t.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('every color is a valid 6-digit hex code', () => {
    for (const t of LESSON_TYPES) {
      expect(t.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
