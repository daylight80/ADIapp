import { lessonBlockColor, isCompletedLesson, COMPLETED_GREEN, COMPLETED_NOTE } from '../diary/lessonLook';
import { colorForLessonType } from '../diary/lessonTypes';

describe('diary lesson look', () => {
  it('turns a completed lesson green, whatever its type', () => {
    expect(isCompletedLesson('Completed')).toBe(true);
    expect(lessonBlockColor('Completed', 'Standard')).toBe(COMPLETED_GREEN);
    expect(lessonBlockColor('Completed', 'Mock Test')).toBe(COMPLETED_GREEN);
  });
  it('leaves other lessons coloured by type', () => {
    for (const status of ['Scheduled', 'Cancelled', null, undefined, '']) {
      expect(isCompletedLesson(status as any)).toBe(false);
      expect(lessonBlockColor(status as any, 'Standard')).toBe(colorForLessonType('Standard'));
    }
  });
  it('says Lesson Completed', () => {
    expect(COMPLETED_NOTE).toMatch(/Lesson Completed/);
  });
});
