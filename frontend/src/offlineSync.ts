import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { patchLesson } from './useSupabaseData';
import type { UpdateLessonInput } from './supabaseDb';

/**
 * Offline-first sync — first slice (25 Aug 2026), scoped deliberately to
 * lesson completion only (grade/faults/payment/notes via "Mark Complete"),
 * per Grant's direction: build the full pattern on the highest-value
 * workflow first, extend to other writes later, rather than attempt the
 * whole app's data layer at once. The backlog itself flags this as "a
 * genuine architecture change, not a feature add" — this module is that
 * pattern, ready to extend to other entity types later without redesigning
 * it (see `entityType` below).
 *
 * How it works:
 *   1. A write that can't reach Supabase (checked proactively via NetInfo,
 *      not by parsing error messages, which is unreliable) gets queued
 *      here instead of failing or silently falling back to mockDb.
 *   2. The queue persists to AsyncStorage, so pending writes survive the
 *      app being closed entirely, not just a screen navigation.
 *   3. A NetInfo listener auto-flushes the queue the moment connectivity
 *      returns — the instructor doesn't have to remember to do anything.
 *   4. sync-status-screen.tsx surfaces this queue directly, with a manual
 *      "Force Sync Now" as a backstop for whenever auto-flush hasn't
 *      caught up yet (patchy signal can flicker on/off in ways a listener
 *      doesn't always catch cleanly).
 */

const QUEUE_KEY = 'offline_sync_queue_v1';

export type PendingWrite = {
  id: string;
  entityType: 'lesson'; // extend this union as more write types get queued
  entityId: string;
  payload: UpdateLessonInput;
  label: string; // human-readable, for the sync-status screen — e.g. "Mark lesson complete — Sarah Jones"
  queuedAt: string;
  lastError?: string; // set only if a real (non-network) error occurred on a sync attempt, so it's visible rather than silently retried forever
};

// Simple pub/sub so every screen watching the queue re-renders on change,
// without needing a full state-management library for one small queue.
type Listener = (queue: PendingWrite[]) => void;
const listeners = new Set<Listener>();
let cachedQueue: PendingWrite[] | null = null;

// Test-only — resets the in-memory cache so each test starts from a clean
// slate after AsyncStorage.clear(). The real app never needs this: it's
// the sole owner of this AsyncStorage key, so the cache and storage never
// drift apart in normal use — this only matters because tests clear
// storage directly, bypassing this module's own read/write path.
export function __resetCacheForTests() {
  cachedQueue = null;
}

async function loadQueue(): Promise<PendingWrite[]> {
  if (cachedQueue) return cachedQueue;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    cachedQueue = raw ? JSON.parse(raw) : [];
  } catch {
    cachedQueue = [];
  }
  return cachedQueue;
}

async function saveQueue(queue: PendingWrite[]) {
  cachedQueue = queue;
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  listeners.forEach((l) => l(queue));
}

/** Queue a lesson-completion write for later sync. Call this when a write
 * couldn't reach Supabase — never call it as the default path. */
export async function queueLessonWrite(entityId: string, payload: UpdateLessonInput, label: string): Promise<void> {
  const queue = await loadQueue();
  const entry: PendingWrite = {
    id: `${entityId}_${Date.now()}`,
    entityType: 'lesson',
    entityId,
    payload,
    label,
    queuedAt: new Date().toISOString(),
  };
  await saveQueue([...queue, entry]);
}

export async function getPendingQueue(): Promise<PendingWrite[]> {
  return loadQueue();
}

/** How many pending writes exist for one specific lesson — for a small
 * "pending sync" badge on that lesson's own row/detail, not just a global
 * count. */
export async function getPendingCountForLesson(lessonId: string): Promise<number> {
  const queue = await loadQueue();
  return queue.filter((w) => w.entityType === 'lesson' && w.entityId === lessonId).length;
}

/** Attempt to apply every queued write for real. Successes are removed;
 * genuine (non-network) failures stay queued with lastError set, so
 * they're visible rather than retried forever with no explanation. Safe
 * to call repeatedly (e.g. on every reconnect) — an empty queue is a
 * no-op. */
export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  const queue = await loadQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  const net = await NetInfo.fetch();
  if (!net.isConnected) return { synced: 0, failed: queue.length };

  let synced = 0;
  const remaining: PendingWrite[] = [];
  for (const write of queue) {
    try {
      if (write.entityType === 'lesson') {
        await patchLesson(write.entityId, write.payload);
      }
      synced += 1;
    } catch (e: any) {
      // A genuine error (not just "still offline") — keep it queued but
      // record why, so the sync-status screen can show something
      // meaningful instead of an endless silent retry.
      remaining.push({ ...write, lastError: e?.message || 'Sync failed' });
    }
  }
  await saveQueue(remaining);
  return { synced, failed: remaining.length };
}

/** Live-updating count of pending writes, for a badge anywhere in the app. */
export function usePendingSyncCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let mounted = true;
    loadQueue().then((q) => { if (mounted) setCount(q.length); });
    const listener: Listener = (q) => { if (mounted) setCount(q.length); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);
  return count;
}

/** The full pending queue, live-updating — for the sync-status screen. */
export function usePendingQueue(): PendingWrite[] {
  const [queue, setQueue] = useState<PendingWrite[]>([]);
  useEffect(() => {
    let mounted = true;
    loadQueue().then((q) => { if (mounted) setQueue(q); });
    const listener: Listener = (q) => { if (mounted) setQueue(q); };
    listeners.add(listener);
    return () => { mounted = false; listeners.delete(listener); };
  }, []);
  return queue;
}

/** Network status, reactive — true/false once known, null while NetInfo's
 * first check is still in flight. */
export function useIsOnline(): boolean | null {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const nowOnline = !!state.isConnected;
      setIsOnline((prevOnline) => {
        // Auto-flush the moment we transition from offline -> online —
        // the instructor shouldn't have to remember to do anything.
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
