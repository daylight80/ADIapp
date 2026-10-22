import AsyncStorage from '@react-native-async-storage/async-storage';

let mockUser: string | null = 'inst-1';
jest.mock('../supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }) } },
}));

import {
  cacheWindow, readWindow, getCachedLesson, overlayPending, lessonFieldsOf, lessonStart, __resetDiaryCacheForTests,
} from '../diaryCache';
import type { Lesson } from '../supabaseDb';

const NOW = new Date(2026, 9, 22, 9, 0); // Thu 22 Oct 2026
const lesson = (id: string, date: string, start = '10:00', extra: Partial<Lesson> = {}): Lesson => ({
  id, student_id: 's1', instructor_id: 'inst-1', vehicle_id: 'v1', date, start_time: start, end_time: '11:00',
  duration_hours: 1, topic: 'Roundabouts', lesson_type: 'Standard', driving_faults: 0, serious_faults: 0,
  dangerous_faults: 0, status: 'Scheduled', ...extra,
});
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetDiaryCacheForTests();
  mockUser = 'inst-1';
});

describe('saved diary copy', () => {
  it('saves a load and gives the same lessons back for that window, earliest first', async () => {
    const rows = [lesson('b', '2026-10-23', '14:00'), lesson('a', '2026-10-23', '09:00'), lesson('c', '2026-10-30')];
    await cacheWindow(day(2026, 10, 19), day(2026, 10, 26), rows.slice(0, 2), NOW);
    const out = await readWindow(day(2026, 10, 19), day(2026, 10, 26));
    expect(out.lessons.map((l) => l.id)).toEqual(['a', 'b']);
    expect(out.savedAt).toBe(NOW.toISOString());
  });

  it('a fresh load replaces what was saved for its dates (a lesson deleted elsewhere disappears) but not other dates', async () => {
    await cacheWindow(day(2026, 10, 19), day(2026, 10, 26), [lesson('a', '2026-10-23'), lesson('b', '2026-10-24')], NOW);
    await cacheWindow(day(2026, 10, 26), day(2026, 11, 2), [lesson('n', '2026-10-28')], NOW);
    await cacheWindow(day(2026, 10, 19), day(2026, 10, 26), [lesson('b', '2026-10-24')], NOW);
    const all = await readWindow(day(2026, 10, 1), day(2026, 12, 1));
    expect(all.lessons.map((l) => l.id)).toEqual(['b', 'n']);
  });

  it('keeps only the last 14 days and the next 90 days', async () => {
    await cacheWindow(day(2026, 1, 1), day(2027, 6, 1), [
      lesson('old', '2026-10-01'), lesson('recent', '2026-10-10'), lesson('far', '2027-03-01'), lesson('soon', '2026-12-01'),
    ], NOW);
    const all = await readWindow(day(2026, 1, 1), day(2027, 6, 1));
    expect(all.lessons.map((l) => l.id)).toEqual(['recent', 'soon']);
  });

  it('never shows one instructor\'s diary to another who signs in on the same phone', async () => {
    await cacheWindow(day(2026, 10, 19), day(2026, 10, 26), [lesson('a', '2026-10-23')], NOW);
    __resetDiaryCacheForTests(); // as after an app restart
    mockUser = 'inst-2';
    expect((await readWindow(day(2026, 10, 19), day(2026, 10, 26))).lessons).toEqual([]);
    expect(await getCachedLesson('a')).toBeUndefined();
  });

  it('survives an app restart, and is encrypted at rest', async () => {
    await cacheWindow(day(2026, 10, 19), day(2026, 10, 26), [lesson('a', '2026-10-23', '10:00', { pickup_address: '1 High St' })], NOW);
    const raw = await AsyncStorage.getItem('diary_cache_v1');
    expect(raw).not.toContain('1 High St');
    __resetDiaryCacheForTests();
    expect((await getCachedLesson('a'))?.pickup_address).toBe('1 High St');
  });

  it('does nothing when nobody is signed in', async () => {
    mockUser = null;
    await cacheWindow(day(2026, 10, 19), day(2026, 10, 26), [lesson('a', '2026-10-23')], NOW);
    expect(await AsyncStorage.getItem('diary_cache_v1')).toBeNull();
    expect((await readWindow(day(2026, 10, 19), day(2026, 10, 26))).lessons).toEqual([]);
  });
});

describe('changes waiting to sync, laid over the saved diary', () => {
  it('shows a cancel and a move; a lesson moved to another day appears on its new day', async () => {
    await cacheWindow(day(2026, 10, 19), day(2026, 11, 2), [lesson('a', '2026-10-23'), lesson('b', '2026-10-28')], NOW);
    const pending = [
      { entityId: 'a', payload: { status: 'Cancelled' } },
      { entityId: 'b', payload: { date: '2026-10-22', start_time: '16:00', end_time: '17:00' } },
    ];
    const thisWeek = await readWindow(day(2026, 10, 19), day(2026, 10, 26), pending);
    expect(thisWeek.lessons.map((l) => [l.id, l.status, l.start_time])).toEqual([['b', 'Scheduled', '16:00'], ['a', 'Cancelled', '10:00']]);
    const nextWeek = await readWindow(day(2026, 10, 26), day(2026, 11, 2), pending);
    expect(nextWeek.lessons).toEqual([]);
  });

  it('ignores fields a Lesson does not have, and leaves other lessons alone', () => {
    expect(lessonFieldsOf({ status: 'Completed', test_start: 'x', payment_method: 'cash', grade: 4 })).toEqual({ status: 'Completed', grade: 4 });
    const rows = [lesson('a', '2026-10-23'), lesson('b', '2026-10-24')];
    const out = overlayPending(rows, [{ entityId: 'a', payload: { grade: 5 } }]);
    expect(out[0].grade).toBe(5);
    expect(out[1]).toBe(rows[1]);
    expect(overlayPending(rows, [])).toBe(rows);
  });

  it('reads a lesson\'s start as local time', () => {
    const d = lessonStart({ date: '2026-10-23', start_time: '14:30' });
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 23, 14, 30]);
  });
});
