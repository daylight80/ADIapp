import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(),
    addEventListener: jest.fn(() => () => {}),
  },
}));

jest.mock('../useSupabaseData', () => ({
  patchLesson: jest.fn(),
}));

import NetInfo from '@react-native-community/netinfo';
import { patchLesson } from '../useSupabaseData';
import { queueLessonWrite, getPendingQueue, getPendingCountForLesson, flushQueue, __resetCacheForTests } from '../offlineSync';

const mockedNetInfoFetch = NetInfo.fetch as jest.Mock;
const mockedPatchLesson = patchLesson as jest.Mock;

describe('offlineSync — queueLessonWrite / getPendingQueue', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetCacheForTests();
    mockedPatchLesson.mockReset();
    mockedNetInfoFetch.mockReset();
  });

  it('starts with an empty queue', async () => {
    expect(await getPendingQueue()).toEqual([]);
  });

  it('adds a queued write with the given label and payload', async () => {
    await queueLessonWrite('lesson-1', { status: 'Completed', grade: 4 }, 'Mark complete — Sarah Jones');
    const queue = await getPendingQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      entityType: 'lesson',
      entityId: 'lesson-1',
      label: 'Mark complete — Sarah Jones',
      payload: { status: 'Completed', grade: 4 },
    });
    expect(queue[0].id).toBeTruthy();
    expect(queue[0].queuedAt).toBeTruthy();
  });

  it('accumulates multiple queued writes in order', async () => {
    await queueLessonWrite('lesson-1', { grade: 3 }, 'First');
    await queueLessonWrite('lesson-2', { grade: 5 }, 'Second');
    const queue = await getPendingQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0].label).toBe('First');
    expect(queue[1].label).toBe('Second');
  });

  it('persists across "restarts" — a fresh read reflects what was queued before', async () => {
    await queueLessonWrite('lesson-1', { grade: 4 }, 'Persisted entry');
    // Simulate a fresh module load reading directly from AsyncStorage,
    // bypassing this module's in-memory cache, the way a real app restart
    // would.
    const raw = await AsyncStorage.getItem('offline_sync_queue_v1');
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].label).toBe('Persisted entry');
  });
});

describe('offlineSync — getPendingCountForLesson', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetCacheForTests();
  });

  it('counts only writes for the specified lesson', async () => {
    await queueLessonWrite('lesson-1', { grade: 3 }, 'A');
    await queueLessonWrite('lesson-1', { grade: 4 }, 'B');
    await queueLessonWrite('lesson-2', { grade: 5 }, 'C');
    expect(await getPendingCountForLesson('lesson-1')).toBe(2);
    expect(await getPendingCountForLesson('lesson-2')).toBe(1);
    expect(await getPendingCountForLesson('lesson-3')).toBe(0);
  });
});

describe('offlineSync — flushQueue', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetCacheForTests();
    mockedPatchLesson.mockReset();
    mockedNetInfoFetch.mockReset();
  });

  it('does nothing and reports zero when the queue is already empty', async () => {
    mockedNetInfoFetch.mockResolvedValue({ isConnected: true });
    const result = await flushQueue();
    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(mockedPatchLesson).not.toHaveBeenCalled();
  });

  it('does not attempt any sync while offline, and reports every item as still failed/pending', async () => {
    await queueLessonWrite('lesson-1', { grade: 4 }, 'Offline test');
    mockedNetInfoFetch.mockResolvedValue({ isConnected: false });
    const result = await flushQueue();
    expect(result).toEqual({ synced: 0, failed: 1 });
    expect(mockedPatchLesson).not.toHaveBeenCalled();
    // Crucially: the item must still be in the queue afterward, not lost.
    expect(await getPendingQueue()).toHaveLength(1);
  });

  it('syncs successfully and removes the entry once online', async () => {
    await queueLessonWrite('lesson-1', { grade: 4, status: 'Completed' }, 'Should sync');
    mockedNetInfoFetch.mockResolvedValue({ isConnected: true });
    mockedPatchLesson.mockResolvedValue(undefined);

    const result = await flushQueue();

    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(mockedPatchLesson).toHaveBeenCalledWith('lesson-1', { grade: 4, status: 'Completed' });
    expect(await getPendingQueue()).toEqual([]);
  });

  it('keeps a genuinely failed write queued with lastError set, rather than losing it silently', async () => {
    await queueLessonWrite('lesson-1', { grade: 4 }, 'Will fail');
    mockedNetInfoFetch.mockResolvedValue({ isConnected: true });
    mockedPatchLesson.mockRejectedValue(new Error('Row not found'));

    const result = await flushQueue();

    expect(result).toEqual({ synced: 0, failed: 1 });
    const queue = await getPendingQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].lastError).toBe('Row not found');
  });

  it('processes a mix of successes and failures independently — one bad write does not block the others', async () => {
    await queueLessonWrite('lesson-1', { grade: 3 }, 'Will succeed');
    await queueLessonWrite('lesson-2', { grade: 4 }, 'Will fail');
    mockedNetInfoFetch.mockResolvedValue({ isConnected: true });
    mockedPatchLesson.mockImplementation(async (id: string) => {
      if (id === 'lesson-2') throw new Error('Conflict');
    });

    const result = await flushQueue();

    expect(result).toEqual({ synced: 1, failed: 1 });
    const queue = await getPendingQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].entityId).toBe('lesson-2');
    expect(queue[0].lastError).toBe('Conflict');
  });
});
