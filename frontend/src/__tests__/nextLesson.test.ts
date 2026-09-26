import { nextUpcomingLesson, describeLessonWhen, lessonBounds } from '../nextLesson';

// A fixed "now": Saturday 26 Sept 2026, 10:00 local.
const NOW = new Date(2026, 8, 26, 10, 0, 0);

const lesson = (over: Partial<{ id: string; date: string; start_time: string; end_time: string; status: string }> = {}) => ({
  id: 'l1',
  date: '2026-09-26',
  start_time: '14:00',
  end_time: '15:00',
  status: 'Scheduled',
  ...over,
});

describe('nextUpcomingLesson', () => {
  it('returns undefined when there are no lessons', () => {
    expect(nextUpcomingLesson([], NOW)).toBeUndefined();
  });

  it('picks the earliest upcoming Scheduled lesson regardless of input order', () => {
    const later = lesson({ id: 'later', date: '2026-09-30' });
    const sooner = lesson({ id: 'sooner', date: '2026-09-27', start_time: '09:00', end_time: '10:00' });
    const soonest = lesson({ id: 'soonest', date: '2026-09-26', start_time: '16:00', end_time: '17:00' });
    expect(nextUpcomingLesson([later, soonest, sooner], NOW)?.id).toBe('soonest');
    expect(nextUpcomingLesson([soonest, later, sooner], NOW)?.id).toBe('soonest');
  });

  it('ignores lessons that have already finished', () => {
    const past = lesson({ id: 'past', date: '2026-09-26', start_time: '08:00', end_time: '09:00' });
    const future = lesson({ id: 'future', date: '2026-09-28' });
    expect(nextUpcomingLesson([past, future], NOW)?.id).toBe('future');
  });

  it('ignores Cancelled and Completed lessons even if their time is in the future', () => {
    const cancelled = lesson({ id: 'c', status: 'Cancelled', date: '2026-09-27' });
    const completed = lesson({ id: 'd', status: 'Completed', date: '2026-09-27' });
    const scheduled = lesson({ id: 's', date: '2026-10-01' });
    expect(nextUpcomingLesson([cancelled, completed, scheduled], NOW)?.id).toBe('s');
    expect(nextUpcomingLesson([cancelled, completed], NOW)).toBeUndefined();
  });

  it('still returns a lesson that is underway right now', () => {
    const underway = lesson({ id: 'now', date: '2026-09-26', start_time: '09:30', end_time: '10:30' });
    expect(nextUpcomingLesson([underway], NOW)?.id).toBe('now');
  });

  it('skips rows with unusable dates or times instead of throwing', () => {
    const bad = lesson({ id: 'bad', date: 'not-a-date' });
    const bad2 = lesson({ id: 'bad2', start_time: '' });
    const good = lesson({ id: 'good', date: '2026-09-29' });
    expect(nextUpcomingLesson([bad, bad2, good], NOW)?.id).toBe('good');
  });

  it('accepts HH:mm:ss times', () => {
    const l = lesson({ id: 'sec', date: '2026-09-27', start_time: '11:00:00', end_time: '12:00:00' });
    expect(nextUpcomingLesson([l], NOW)?.id).toBe('sec');
  });
});

describe('lessonBounds', () => {
  it('treats a missing end time as ending when it starts', () => {
    const b = lessonBounds(lesson({ end_time: '' }));
    expect(b).not.toBeNull();
    expect(b!.end.getTime()).toBe(b!.start.getTime());
  });

  it('returns null for an unparseable date', () => {
    expect(lessonBounds(lesson({ date: 'x' }))).toBeNull();
  });
});

describe('describeLessonWhen', () => {
  it('says Today for a lesson later today', () => {
    expect(describeLessonWhen(lesson(), NOW)).toEqual({ day: 'Today', time: '14:00–15:00', inProgress: false });
  });

  it('says Tomorrow for a lesson tomorrow', () => {
    expect(describeLessonWhen(lesson({ date: '2026-09-27' }), NOW)?.day).toBe('Tomorrow');
  });

  it('uses a weekday and date for later days', () => {
    const w = describeLessonWhen(lesson({ date: '2026-09-30' }), NOW);
    expect(w?.day).toMatch(/30/);
    expect(w?.day).not.toBe('Today');
    expect(w?.day).not.toBe('Tomorrow');
  });

  it('flags a lesson that is underway', () => {
    const w = describeLessonWhen(lesson({ start_time: '09:30', end_time: '10:30' }), NOW);
    expect(w?.inProgress).toBe(true);
  });

  it('is not in progress before it starts', () => {
    expect(describeLessonWhen(lesson(), NOW)?.inProgress).toBe(false);
  });

  it('pads single-digit hours and trims seconds', () => {
    const w = describeLessonWhen(lesson({ start_time: '9:05', end_time: '10:05:00' }), NOW);
    expect(w?.time).toBe('09:05–10:05');
  });

  it('shows just the start time when there is no usable end time', () => {
    expect(describeLessonWhen(lesson({ end_time: '' }), NOW)?.time).toBe('14:00');
  });

  it('returns null for an unusable lesson', () => {
    expect(describeLessonWhen(lesson({ date: 'x' }), NOW)).toBeNull();
  });
});
