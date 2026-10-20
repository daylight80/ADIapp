import { lessonAddress } from '../maps';

jest.mock('../api', () => ({ api: { post: jest.fn() } }));

const student: any = { address: '12 Abbey Road', postcode: 'NW8 9AY' };
const lesson = (over: object): any => ({ lesson_type: 'Standard', ...over });

describe('lessonAddress', () => {
  it('heads to the test centre for a Practical Test', () => {
    expect(lessonAddress(lesson({ lesson_type: 'Practical Test', test_centre: 'Morden Test Centre', pickup_address: '1 High St' }), student))
      .toBe('Morden Test Centre');
  });

  it('uses the lesson pickup when there is one', () => {
    expect(lessonAddress(lesson({ pickup_address: '5 Mill Lane, SM1 1AA' }), student)).toBe('5 Mill Lane, SM1 1AA');
  });

  it('falls back to the pupil address', () => {
    expect(lessonAddress(lesson({}), student)).toBe('12 Abbey Road, NW8 9AY');
  });

  it('a Practical Test with no centre entered still falls back to the pickup', () => {
    expect(lessonAddress(lesson({ lesson_type: 'Practical Test' }), student)).toBe('12 Abbey Road, NW8 9AY');
  });

  it('only a Practical Test uses the test centre', () => {
    expect(lessonAddress(lesson({ test_centre: 'Somewhere' }), student)).toBe('12 Abbey Road, NW8 9AY');
  });
});
