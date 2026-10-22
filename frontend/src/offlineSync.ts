import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { patchLesson, bump } from './useSupabaseData';
import { getLessonById } from './supabaseDb';
import type { UpdateLessonInput } from './supabaseDb';
import { lessonFieldsOf } from './diaryCache';
import { isNetworkError } from './networkError';
import { loadQueue, saveQueue, queueLessonWrite, type PendingWrite } from './offlineQueue';

/**
 * Offline-first sync. A write that can't reach Supabase (checked proactively via NetInfo, not by parsing error
 * messages, which is unreliable) is queued instead of failing; a NetInfo listener flushes the queue the moment
 * connectivity returns, and sync-status-screen.tsx shows it with a manual "Force sync now" as a backstop.
 *
 * First slice (25 Aug 2026): lesson completion only. Offline diary (22 Oct 2026): every lesson edit, cancel and
 * move made through patchLessonOfflineAware() queues the same way, the diary reads a saved copy (diaryCache.ts), and
 * a lesson changed or deleted on another device in the meantime is NOT overwritten: the change stays queued marked
 * as a conflict, and the instructor picks "Keep mine" or "Use theirs" on the sync screen.
 *
 * The queue itself lives in offlineQueue.ts and is re-exported here.
 */
export {
  queueLessonWrite, getPendingQueue, getPendingCountForLesson, usePendingSyncCount, usePendingQueue, __resetCacheForTests,
} from './offlineQueue';
export type { PendingWrite, ConflictInfo } from './offlineQueue';

export { isNetworkError } from './networkError';

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || String(a ?? '') === String(b ?? '');

/** Attempt to apply every queued write for real. Successes are removed. Genuine (non-network) failures stay queued with
 * lastError set. A lesson changed or deleted elsewhere stays queued marked as a conflict, untouched, for the
 * instructor to decide. Safe to call repeatedly (e.g. on every reconnect); an empty queue is a no-op. */
export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  const queue = await loadQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  const net = await NetInfo.fetch();
  if (!net.isConnected) return { synced: 0, failed: queue.length };

  let synced = 0;
  const remaining: PendingWrite[] = [];
  // Fields this flush has already changed on a lesson: a later queued change to the same field must not be treated as a
  // conflict with our own earlier change.
  const ours = new Map<string, Set<string>>();

  for (const write of queue) {
    if (write.conflict) { remaining.push(write); continue; } // waiting for the instructor's choice
    try {
      if (write.base) {
        const current = await getLessonById(write.entityId);
        if (!current) {
          remaining.push({ ...write, conflict: { kind: 'deleted' }, lastError: undefined });
          continue;
        }
        const mine = ours.get(write.entityId) ?? new Set<string>();
        const differing = Object.keys(write.base).filter(
          (k) => !mine.has(k) && !same((write.base as Record<string, unknown>)[k], (current as unknown as Record<string, unknown>)[k]),
        );
        if (differing.length) {
          const theirs: Record<string, unknown> = {};
          for (const k of Object.keys(write.base)) theirs[k] = (current as unknown as Record<string, unknown>)[k] ?? null;
          remaining.push({ ...write, conflict: { kind: 'changed', theirs }, lastError: undefined });
          continue;
        }
      }
      if (write.entityType === 'lesson') {
        await patchLesson(write.entityId, write.payload);
        const set = ours.get(write.entityId) ?? new Set<string>();
        Object.keys(lessonFieldsOf(write.payload as Record<string, unknown>)).forEach((k) => set.add(k));
        ours.set(write.entityId, set);
      }
      synced += 1;
    } catch (e: any) {
      // Went offline part-way through: not a real failure, just keep it as it was.
      if (isNetworkError(e)) remaining.push(write);
      else remaining.push({ ...write, lastError: e?.message || 'Sync failed' });
    }
  }
  await saveQueue(remaining);
  if (remaining.length !== queue.length) bump();
  return { synced, failed: remaining.length };
}

/**
 * Change a lesson, or queue the change if there is no signal (or it is lost mid-save). Returns whether it was queued.
 * Use this instead of patchLesson for edits, moves and cancels made from the diary.
 */
export async function patchLessonOfflineAware(
  id: string,
  patch: UpdateLessonInput,
  label: string,
): Promise<{ queued: boolean }> {
  const net = await NetInfo.fetch();
  if (net.isConnected) {
    try {
      await patchLesson(id, patch);
      return { queued: false };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  await queueLessonWrite(id, patch, label);
  bump(); // the diary lays queued changes over its saved copy
  return { queued: true };
}

/** Settle a lesson changed elsewhere: "mine" applies this change anyway, "theirs" drops it. */
export async function resolveConflict(writeId: string, choice: 'mine' | 'theirs'): Promise<void> {
  const queue = await loadQueue();
  const target = queue.find((w) => w.id === writeId);
  if (!target) return;
  if (choice === 'theirs') {
    await saveQueue(queue.filter((w) => w.id !== writeId));
    bump();
    return;
  }
  await saveQueue(queue.map((w) => (w.id === writeId ? { ...w, base: undefined, conflict: undefined, lastError: undefined } : w)));
  await flushQueue();
}

/** Network status, reactive: true/false once known, null while NetInfo's first check is still in flight. */
export function useIsOnline(): boolean | null {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const nowOnline = !!state.isConnected;
      setIsOnline((prevOnline) => {
        // Auto-flush the moment we transition from offline -> online.
        if (prevOnline === false && nowOnline) {
          flushQueue().catch(() => {});
        }
        return nowOnline;
      });
    });
    NetInfo.fetch().then((state) => setIsOnline(!!state.isConnected));
    return () => unsubscribe();
  }, []);
  return isOnline;
}
