import { findNextSlots, type SlotLesson } from '../diary/nextSlots';

const base = { blocks: [], today: '2030-03-04', nowMin: 0, length: 120, travel: 0, workStart: '08:00', workEnd: '18:00' };
const lesson = (date: string, start_time: string, end_time: string, extra: Partial<SlotLesson> = {}): SlotLesson => ({ date, start_time, end_time, ...extra });

describe('findNextSlots', () => {
  it('offers three non-overlapping slots from the start of working hours on an empty diary', () => {
    expect(findNextSlots({ ...base, lessons: [] })).toEqual([
      { date: '2030-03-04', start: '08:00', end: '10:00' },
      { date: '2030-03-04', start: '10:00', end: '12:00' },
      { date: '2030-03-04', start: '12:00', end: '14:00' },
    ]);
  });

  it('never offers a time that has already passed today', () => {
    const s = findNextSlots({ ...base, lessons: [], nowMin: 9 * 60 + 10 });
    expect(s[0]).toEqual({ date: '2030-03-04', start: '09:15', end: '11:15' });
  });

  it('skips booked lessons and cancelled ones do not count', () => {
    const s = findNextSlots({
      ...base, length: 60, workEnd: '12:00',
      lessons: [lesson('2030-03-04', '08:00', '10:00'), lesson('2030-03-04', '10:00', '11:00', { status: 'Cancelled' })],
    });
    expect(s[0]).toEqual({ date: '2030-03-04', start: '10:00', end: '11:00' });
  });

  it('leaves room for travel after the lesson before and before the lesson after', () => {
    const s = findNextSlots({
      ...base, length: 60, travel: 20, workStart: '09:00', workEnd: '13:00', count: 1,
      lessons: [lesson('2030-03-04', '09:00', '10:00'), lesson('2030-03-04', '11:30', '12:30', { travel_minutes: 30 })],
    });
    // after the 10:00 finish it needs 20 min travel, so 10:30 earliest on the 15-minute grid;
    // 10:30-11:30 leaves no 30 min before the next lesson, so it must move to the next day
    expect(s[0].date).toBe('2030-03-05');
  });

  it('finds a gap between two lessons when the travel fits exactly', () => {
    const s = findNextSlots({
      ...base, length: 60, travel: 15, workStart: '09:00', workEnd: '13:00', count: 1,
      lessons: [lesson('2030-03-04', '09:00', '10:00'), lesson('2030-03-04', '12:00', '13:00', { travel_minutes: 15 })],
    });
    expect(s[0]).toEqual({ date: '2030-03-04', start: '10:15', end: '11:15' });
  });

  it('avoids time off', () => {
    const s = findNextSlots({
      ...base, length: 60, workEnd: '12:00', count: 1,
      lessons: [],
      blocks: [{ starts_at: new Date('2030-03-04T08:00:00').toISOString(), ends_at: new Date('2030-03-04T10:30:00').toISOString() }],
    });
    expect(s[0]).toEqual({ date: '2030-03-04', start: '10:30', end: '11:30' });
  });

  it('moves to the next day when today is full, and gives up quietly when nothing fits', () => {
    const full = findNextSlots({ ...base, lessons: [lesson('2030-03-04', '08:00', '18:00')], count: 1 });
    expect(full[0].date).toBe('2030-03-05');
    expect(findNextSlots({ ...base, lessons: [], length: 12 * 60 })).toEqual([]);
  });

  it('does not offer a slot that would run past the end of working hours', () => {
    expect(findNextSlots({ ...base, lessons: [], workStart: '16:00', workEnd: '17:30', length: 120, days: 3 })).toEqual([]);
  });
});
