import { matchRoutesToLessons, localDayAndMinutes } from '../lessonRoutes';
import type { SavedRoute } from '../routeRecorder';

// Built from local time so the tests give the same answer in any time zone.
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString();
const route = (id: string, startedAt: string, extra: Partial<SavedRoute> = {}): SavedRoute => ({
  id, name: id, startedAt, endedAt: startedAt, durationSec: 60, distanceMeters: 100, points: [], ...extra,
});
const lesson = (id: string, date: string, start_time: string, status = 'Completed') => ({ id, date, start_time, status });

describe('matchRoutesToLessons', () => {
  const lessons = [
    lesson('am', '2026-10-17', '09:00'),
    lesson('pm', '2026-10-17', '11:30'),
    lesson('other-day', '2026-10-18', '09:00'),
  ];

  it('puts a route recorded from a lesson on that lesson, whatever the day', () => {
    const r = route('r1', at(2026, 10, 20, 9, 0), { lessonId: 'pm' });
    expect(matchRoutesToLessons(lessons, [r]).byLesson).toEqual({ pm: [r] });
  });

  it('matches a profile recording to the same-day lesson that started closest', () => {
    const early = route('early', at(2026, 10, 17, 9, 5));
    const late = route('late', at(2026, 10, 17, 11, 40));
    const { byLesson, unmatched } = matchRoutesToLessons(lessons, [early, late]);
    expect(byLesson.am).toEqual([early]);
    expect(byLesson.pm).toEqual([late]);
    expect(unmatched).toEqual([]);
  });

  it('leaves a route on the profile when there is no lesson that day', () => {
    const r = route('lonely', at(2026, 10, 19, 10, 0));
    expect(matchRoutesToLessons(lessons, [r])).toEqual({ byLesson: {}, unmatched: [r] });
  });

  it('ignores cancelled lessons and links to lessons that are not in the list', () => {
    const cancelled = [lesson('c', '2026-10-17', '09:00', 'Cancelled')];
    const r1 = route('r1', at(2026, 10, 17, 9, 0));
    const r2 = route('r2', at(2026, 10, 17, 9, 0), { lessonId: 'gone' });
    expect(matchRoutesToLessons(cancelled, [r1, r2]).unmatched).toEqual([r1, r2]);
  });

  it('orders several routes on one lesson by start time, and copes with unreadable dates', () => {
    const second = route('b', at(2026, 10, 17, 10, 0), { lessonId: 'am' });
    const first = route('a', at(2026, 10, 17, 9, 10), { lessonId: 'am' });
    expect(matchRoutesToLessons(lessons, [second, first]).byLesson.am.map((r) => r.id)).toEqual(['a', 'b']);
    const bad = route('bad', 'not a date');
    expect(matchRoutesToLessons(lessons, [bad]).unmatched).toEqual([bad]);
    expect(localDayAndMinutes('not a date')).toBeNull();
  });
});
