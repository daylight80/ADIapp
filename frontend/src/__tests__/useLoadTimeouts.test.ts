import { renderHook, act } from '@testing-library/react-native';

// The hooks talk to Supabase through these two modules; replace both so no
// real client is created and each test controls exactly what a load does.
jest.mock('../supabaseClient', () => ({ supabase: {} }));
jest.mock('../supabaseDb', () => ({
  listStudents: jest.fn(),
  getStudent: jest.fn(),
  listLessonsBetween: jest.fn(),
}));

import * as db from '../supabaseDb';
import { useStudents, useStudent, useTodayLessons, useLessonsForWeek } from '../useSupabaseData';
import { SLOW_LOAD_MESSAGE } from '../withTimeout';

const mocked = db as unknown as {
  listStudents: jest.Mock; getStudent: jest.Mock; listLessonsBetween: jest.Mock;
};

const never = () => new Promise<never>(() => {});
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  jest.useFakeTimers();
  mocked.listStudents.mockReset();
  mocked.getStudent.mockReset();
  mocked.listLessonsBetween.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('useStudents', () => {
  it('loads the list', async () => {
    mocked.listStudents.mockResolvedValue([{ id: 's1', name: 'Sam' }]);
    const { result } = await renderHook(() => useStudents());
    await flush();
    expect(result.current.students).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('shows a real error\'s own message straight away, not the slow-connection one', async () => {
    mocked.listStudents.mockRejectedValue(new Error('permission denied for table students'));
    const { result } = await renderHook(() => useStudents());
    await flush();
    expect(result.current.error).toBe('permission denied for table students');
    expect(result.current.loading).toBe(false);
  });

  it('gives up on a stalled load after 15 seconds with the slow-connection message', async () => {
    mocked.listStudents.mockReturnValue(never());
    const { result } = await renderHook(() => useStudents());
    await flush();
    expect(result.current.loading).toBe(true);
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(result.current.error).toBe(SLOW_LOAD_MESSAGE);
    expect(result.current.loading).toBe(false);
  });

  it('refresh() tries again and clears the error', async () => {
    mocked.listStudents.mockReturnValueOnce(never()).mockResolvedValueOnce([{ id: 's1' }]);
    const { result } = await renderHook(() => useStudents());
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(result.current.error).toBe(SLOW_LOAD_MESSAGE);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(result.current.students).toHaveLength(1);
  });
});

describe('useStudent', () => {
  it('keeps a real error\'s message and times out a stall', async () => {
    mocked.getStudent.mockRejectedValueOnce(new Error('JWT expired'));
    const first = await renderHook(() => useStudent('abc'));
    await flush();
    expect(first.result.current.error).toBe('JWT expired');

    mocked.getStudent.mockReturnValueOnce(never());
    const second = await renderHook(() => useStudent('def'));
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(second.result.current.error).toBe(SLOW_LOAD_MESSAGE);
  });
});

describe('lesson loaders (Home and the diary)', () => {
  it('a failed load is an error, not an empty day', async () => {
    mocked.listLessonsBetween.mockRejectedValue(new Error('network request failed'));
    const { result } = await renderHook(() => useTodayLessons());
    await flush();
    expect(result.current.error).toBe('network request failed');
    expect(result.current.lessons).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('a stalled load times out instead of spinning forever', async () => {
    mocked.listLessonsBetween.mockReturnValue(never());
    const { result } = await renderHook(() => useTodayLessons());
    await flush();
    expect(result.current.loading).toBe(true);
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(result.current.error).toBe(SLOW_LOAD_MESSAGE);
    expect(result.current.loading).toBe(false);
  });

  it('refresh() fetches again and recovers', async () => {
    mocked.listLessonsBetween.mockReturnValueOnce(never()).mockResolvedValueOnce([{ id: 'l1' }]);
    const { result } = await renderHook(() => useTodayLessons());
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(result.current.error).toBe(SLOW_LOAD_MESSAGE);
    await act(async () => { result.current.refresh(); });
    await flush();
    expect(mocked.listLessonsBetween).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.lessons).toHaveLength(1);
  });

  it('the diary week loader behaves the same way', async () => {
    mocked.listLessonsBetween.mockReturnValue(never());
    const monday = new Date(2026, 8, 28);
    const { result } = await renderHook(() => useLessonsForWeek(monday));
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(result.current.error).toBe(SLOW_LOAD_MESSAGE);
    expect(result.current.lessons).toEqual([]);
  });
});
