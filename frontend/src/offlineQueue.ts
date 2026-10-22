import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UpdateLessonInput, Lesson } from './supabaseDb';
import { encryptBlob, decryptBlob, isEncryptedBlob } from './secureBlob';
import { getCachedLesson, lessonFieldsOf } from './diaryCache';

/**
 * The queue of changes made while offline, waiting to reach Supabase. Split out of offlineSync.ts (22 Oct 2026) so the
 * diary hooks can lay these changes over the saved diary without a circular import. offlineSync.ts re-exports all of
 * this, so existing imports keep working; see there for how the queue is flushed.
 *
 * The queue persists to AsyncStorage (encrypted: payloads can include lesson notes and amounts paid; see
 * secureBlob.ts), so pending writes survive the app being closed.
 */

const QUEUE_KEY = 'offline_sync_queue_v1';

export type ConflictInfo = {
  kind: 'changed' | 'deleted';
  /** What the lesson looks like on the server now (the fields this change touches). */
  theirs?: Partial<Lesson>;
};

export type PendingWrite = {
  id: string;
  entityType: 'lesson'; // extend this union as more write types get queued
  entityId: string;
  payload: UpdateLessonInput;
  label: string; // human-readable, for the sync-status screen, e.g. "Mark lesson complete — Sarah Jones"
  queuedAt: string;
  lastError?: string; // set only if a real (non-network) error occurred on a sync attempt, so it's visible rather than silently retried forever
  /** The lesson's values for the fields this change touches, as they were when it was made (to spot edits made elsewhere). */
  base?: Partial<Lesson>;
  /** Set when the lesson was changed or deleted elsewhere in the meantime; the instructor chooses what happens. */
  conflict?: ConflictInfo;
};

// Simple pub/sub so every screen watching the queue re-renders on change, without needing a state library.
type Listener = (queue: PendingWrite[]) => void;
const listeners = new Set<Listener>();
let cachedQueue: PendingWrite[] | null = null;

// Test-only: resets the in-memory cache so each test starts clean after AsyncStorage.clear().
export function __resetCacheForTests() {
  cachedQueue = null;
}

export async function loadQueue(): Promise<PendingWrite[]> {
  if (cachedQueue) return cachedQueue;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) {
      cachedQueue = [];
    } else {
      // Legacy fallback: plaintext JSON written before encryption existed. Reading it plain means no pending write is
      // lost; the next saveQueue() re-saves it encrypted.
      const json = isEncryptedBlob(raw) ? await decryptBlob(raw) : raw;
      cachedQueue = JSON.parse(json);
    }
  } catch {
    cachedQueue = [];
  }
  return cachedQueue || [];
}

export async function saveQueue(queue: PendingWrite[]) {
  cachedQueue = queue;
  const encrypted = await encryptBlob(JSON.stringify(queue));
  await AsyncStorage.setItem(QUEUE_KEY, encrypted);
  listeners.forEach((l) => l(queue));
}

/**
 * Queue a lesson write for later sync. Call this when a write couldn't reach Supabase, never as the default path.
 * The lesson's current saved values for the fields being changed are kept as `base`, so a change made on another
 * device in the meantime is noticed instead of overwritten.
 */
export async function queueLessonWrite(entityId: string, payload: UpdateLessonInput, label: string): Promise<void> {
  const queue = await loadQueue();
  const earlier = queue.find((w) => w.entityId === entityId && w.base);
  let base: Partial<Lesson> | undefined;
  try {
    const cached = await getCachedLesson(entityId);
    if (cached) {
      const fields = Object.keys(lessonFieldsOf(payload as Record<string, unknown>)) as (keyof Lesson)[];
      base = {};
      for (const k of fields) (base as Record<string, unknown>)[k] = cached[k] ?? null;
      // A second change to the same lesson keeps comparing against what the server last had, not the first change.
      if (earlier?.base) base = { ...base, ...earlier.base };
    }
  } catch {
    base = undefined;
  }
  const entry: PendingWrite = {
    id: `${entityId}_${Date.now()}`,
    entityType: 'lesson',
    entityId,
    payload,
    label,
    queuedAt: new Date().toISOString(),
    ...(base ? { base } : {}),
  };
  await saveQueue([...queue, entry]);
}

export async function getPendingQueue(): Promise<PendingWrite[]> {
  return loadQueue();
}

/** How many pending writes exist for one specific lesson, for a small "pending sync" badge on that lesson. */
export async function getPendingCountForLesson(lessonId: string): Promise<number> {
  const queue = await loadQueue();
  return queue.filter((w) => w.entityType === 'lesson' && w.entityId === lessonId).length;
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

/** The full pending queue, live-updating, for the sync-status screen. */
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
