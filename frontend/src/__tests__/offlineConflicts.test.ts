import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(), addEventListener: jest.fn(() => () => {}) },
}));
jest.mock('../useSupabaseData', () => ({ patchLesson: jest.fn(), bump: jest.fn() }));
jest.mock('../supabaseDb', () => ({ getLessonById: jest.fn() }));
const mockCached = jest.fn();
jest.mock('../diaryCache', () => ({
  getCachedLesson: (...a: unknown[]) => mockCached(...a),
  lessonFieldsOf: jest.requireActual('../diaryCache').lessonFieldsOf,
}));

import NetInfo from '@react-native-community/netinfo';
import { patchLesson, bump } from '../useSupabaseData';
import { getLessonById } from '../supabaseDb';
import {
  queueLessonWrite, getPendingQueue, flushQueue, patchLessonOfflineAware, resolveConflict, isNetworkError, __resetCacheForTests,
} from '../offlineSync';
import { conflictLines } from '../offlineConflict';

const net = NetInfo.fetch as jest.Mock;
const patch = patchLesson as jest.Mock;
const getLesson = getLessonById as jest.Mock;

const server = (over: Record<string, unknown> = {}) => ({ id: 'L1', date: '2026-10-23', start_time: '10:00', end_time: '11:00', status: 'Scheduled', topic: 'Roundabouts', ...over });

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetCacheForTests();
  [net, patch, getLesson, mockCached, bump as jest.Mock].forEach((m) => m.mockReset());
  net.mockResolvedValue({ isConnected: true });
  mockCached.mockResolvedValue(server());
  getLesson.mockResolvedValue(server());
});

describe('queueing from the saved diary', () => {
  it('records the lesson\'s saved values for the fields being changed', async () => {
    await queueLessonWrite('L1', { status: 'Cancelled', cancellation_charge: 0 }, 'Cancel');
    const [w] = await getPendingQueue();
    expect(w.base).toEqual({ status: 'Scheduled', cancellation_charge: null });
  });

  it('keeps the original server values when the same lesson is changed twice offline', async () => {
    await queueLessonWrite('L1', { start_time: '11:00' }, 'Move 1');
    mockCached.mockResolvedValue(server({ start_time: '11:00' })); // would be wrong to trust: it is not what the server has
    await queueLessonWrite('L1', { start_time: '12:00' }, 'Move 2');
    const q = await getPendingQueue();
    expect(q[1].base).toEqual({ start_time: '10:00' });
  });
});

describe('syncing', () => {
  it('applies a change when the lesson is untouched on the server', async () => {
    await queueLessonWrite('L1', { status: 'Cancelled' }, 'Cancel');
    expect(await flushQueue()).toEqual({ synced: 1, failed: 0 });
    expect(patch).toHaveBeenCalledWith('L1', { status: 'Cancelled' });
    expect(await getPendingQueue()).toEqual([]);
  });

  it('does NOT overwrite a lesson changed elsewhere: keeps it queued as a conflict', async () => {
    await queueLessonWrite('L1', { start_time: '12:00', end_time: '13:00', date: '2026-10-23' }, 'Move');
    getLesson.mockResolvedValue(server({ start_time: '15:00' }));
    expect(await flushQueue()).toEqual({ synced: 0, failed: 1 });
    expect(patch).not.toHaveBeenCalled();
    const [w] = await getPendingQueue();
    expect(w.conflict?.kind).toBe('changed');
    expect(conflictLines(w)).toEqual(['Start: yours 12:00, now 15:00']);
  });

  it('flags a lesson deleted elsewhere', async () => {
    await queueLessonWrite('L1', { status: 'Cancelled' }, 'Cancel');
    getLesson.mockResolvedValue(null);
    await flushQueue();
    const [w] = await getPendingQueue();
    expect(w.conflict).toEqual({ kind: 'deleted' });
    expect(conflictLines(w)).toEqual(['This lesson was deleted on another device.']);
  });

  it('does not treat its own earlier change as a conflict', async () => {
    await queueLessonWrite('L1', { start_time: '11:00' }, 'Move 1');
    await queueLessonWrite('L1', { start_time: '12:00' }, 'Move 2');
    // The server reflects the first change by the time the second is checked.
    getLesson.mockResolvedValueOnce(server()).mockResolvedValueOnce(server({ start_time: '11:00' }));
    expect(await flushQueue()).toEqual({ synced: 2, failed: 0 });
  });

  it('leaves a conflict alone on later syncs until the instructor decides', async () => {
    await queueLessonWrite('L1', { start_time: '12:00' }, 'Move');
    getLesson.mockResolvedValue(server({ start_time: '15:00' }));
    await flushQueue();
    getLesson.mockClear();
    await flushQueue();
    expect(getLesson).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('keeps a change as it was when the connection drops part-way (not a real failure)', async () => {
    await queueLessonWrite('L1', { status: 'Cancelled' }, 'Cancel');
    getLesson.mockRejectedValue(new Error('Network request failed'));
    await flushQueue();
    const [w] = await getPendingQueue();
    expect(w.lastError).toBeUndefined();
    expect(w.conflict).toBeUndefined();
  });
});

describe('resolving a conflict', () => {
  const makeConflict = async () => {
    await queueLessonWrite('L1', { start_time: '12:00' }, 'Move');
    getLesson.mockResolvedValue(server({ start_time: '15:00' }));
    await flushQueue();
    return (await getPendingQueue())[0].id;
  };

  it('"Keep mine" applies the change anyway', async () => {
    const id = await makeConflict();
    patch.mockResolvedValue(undefined);
    await resolveConflict(id, 'mine');
    expect(patch).toHaveBeenCalledWith('L1', { start_time: '12:00' });
    expect(await getPendingQueue()).toEqual([]);
  });

  it('"Use theirs" drops the change and refreshes the diary', async () => {
    const id = await makeConflict();
    (bump as jest.Mock).mockClear();
    await resolveConflict(id, 'theirs');
    expect(patch).not.toHaveBeenCalled();
    expect(await getPendingQueue()).toEqual([]);
    expect(bump).toHaveBeenCalled();
  });
});

describe('patchLessonOfflineAware', () => {
  it('saves straight away when online', async () => {
    patch.mockResolvedValue(undefined);
    await expect(patchLessonOfflineAware('L1', { status: 'Cancelled' }, 'Cancel')).resolves.toEqual({ queued: false });
    expect(await getPendingQueue()).toEqual([]);
  });

  it('queues when there is no signal, and refreshes the diary', async () => {
    net.mockResolvedValue({ isConnected: false });
    await expect(patchLessonOfflineAware('L1', { status: 'Cancelled' }, 'Cancel')).resolves.toEqual({ queued: true });
    expect(patch).not.toHaveBeenCalled();
    expect(await getPendingQueue()).toHaveLength(1);
    expect(bump).toHaveBeenCalled();
  });

  it('queues when the connection is lost mid-save, but lets a real error through', async () => {
    patch.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(patchLessonOfflineAware('L1', { status: 'Cancelled' }, 'Cancel')).resolves.toEqual({ queued: true });
    patch.mockRejectedValueOnce(new Error('permission denied'));
    await expect(patchLessonOfflineAware('L1', { status: 'Cancelled' }, 'Cancel')).rejects.toThrow('permission denied');
  });

  it('recognises network errors', () => {
    expect(isNetworkError(new Error('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new Error('Timed out after 15000ms'))).toBe(true);
    expect(isNetworkError(new Error('permission denied for table lessons'))).toBe(false);
  });
});
