// A saved copy of the instructor's diary, so it still opens with no signal.
//
// Every successful diary load saves the lessons it fetched. With no signal the diary reads this copy instead, with any
// changes still waiting to sync laid over the top. The copy is encrypted (lessons carry pick-up addresses and notes),
// is kept per signed-in instructor, and keeps only the last 14 days and next 90 days.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';
import { encryptBlob, decryptBlob, isEncryptedBlob } from './secureBlob';
import type { Lesson } from './supabaseDb';

const KEY = 'diary_cache_v1';
const KEEP_PAST_DAYS = 14;
const KEEP_FUTURE_DAYS = 90;
const DAY = 86_400_000;

type Stored = { userId: string; savedAt: string; lessons: Lesson[] };
let memory: Stored | null = null;

export function __resetDiaryCacheForTests() {
  memory = null;
}

/** When a lesson starts, as a Date (the lesson's own date and HH:mm are local time). */
export function lessonStart(l: Pick<Lesson, 'date' | 'start_time'>): Date {
  const [y, m, d] = l.date.split('-').map(Number);
  const [h, mi] = (l.start_time || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, h || 0, mi || 0, 0, 0);
}

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession(); // reads the stored session, so it works offline
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function load(userId: string): Promise<Stored> {
  if (memory && memory.userId === userId) return memory;
  let stored: Stored | null = null;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const json = isEncryptedBlob(raw) ? await decryptBlob(raw) : raw;
      stored = JSON.parse(json);
    }
  } catch {
    stored = null;
  }
  // Another instructor signed in on this phone: never show their diary.
  memory = stored && stored.userId === userId && Array.isArray(stored.lessons)
    ? stored
    : { userId, savedAt: '', lessons: [] };
  return memory;
}

async function save(next: Stored) {
  memory = next;
  try {
    await AsyncStorage.setItem(KEY, await encryptBlob(JSON.stringify(next)));
  } catch {
    // The copy is a convenience: failing to save it must never break a diary load.
  }
}

/** Remember a successful load of the window [from, to): replaces what was saved for those dates. */
export async function cacheWindow(from: Date, to: Date, lessons: Lesson[], now: Date = new Date()): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const cur = await load(userId);
  const inWindow = (l: Lesson) => {
    const t = lessonStart(l).getTime();
    return t >= from.getTime() && t < to.getTime();
  };
  const lo = now.getTime() - KEEP_PAST_DAYS * DAY;
  const hi = now.getTime() + KEEP_FUTURE_DAYS * DAY;
  const byId = new Map<string, Lesson>();
  for (const l of cur.lessons) if (!inWindow(l)) byId.set(l.id, l);
  for (const l of lessons) byId.set(l.id, l);
  const kept = [...byId.values()].filter((l) => {
    const t = lessonStart(l).getTime();
    return t >= lo && t <= hi;
  });
  await save({ userId, savedAt: now.toISOString(), lessons: kept });
}

/**
 * The saved lessons starting in [from, to), earliest first, with changes still waiting to sync laid over them (before
 * the date filter, so a lesson moved to another day shows on its new day), and when the copy was last refreshed.
 */
export async function readWindow(
  from: Date,
  to: Date,
  pending: { entityId: string; payload: Record<string, unknown> }[] = [],
): Promise<{ lessons: Lesson[]; savedAt: string | null }> {
  const userId = await currentUserId();
  if (!userId) return { lessons: [], savedAt: null };
  const cur = await load(userId);
  const lessons = overlayPending(cur.lessons, pending)
    .filter((l) => {
      const t = lessonStart(l).getTime();
      return t >= from.getTime() && t < to.getTime();
    })
    .sort((a, b) => lessonStart(a).getTime() - lessonStart(b).getTime());
  return { lessons, savedAt: cur.savedAt || null };
}

/** One saved lesson, or undefined. */
export async function getCachedLesson(id: string): Promise<Lesson | undefined> {
  const userId = await currentUserId();
  if (!userId) return undefined;
  return (await load(userId)).lessons.find((l) => l.id === id);
}

/** Lesson fields a queued change can carry, by the name it has on a Lesson. */
const LESSON_KEYS: (keyof Lesson)[] = [
  'date', 'start_time', 'end_time', 'topic', 'lesson_type', 'pickup_address', 'test_centre', 'travel_minutes', 'notes',
  'driving_faults', 'serious_faults', 'dangerous_faults', 'grade', 'amount_paid', 'quoted_amount', 'status',
  'pre_check_completed_at', 'cancellation_charge', 'cancellation_note',
];

/** The fields of a change that a Lesson also has (the rest, such as test_start, aren't compared or shown). */
export function lessonFieldsOf(patch: Record<string, unknown>): Partial<Lesson> {
  const out: Record<string, unknown> = {};
  for (const k of LESSON_KEYS) if (patch[k as string] !== undefined) out[k as string] = patch[k as string];
  return out as Partial<Lesson>;
}

/** Lay changes that are still waiting to sync over saved or fetched lessons, so the diary shows them. */
export function overlayPending(
  lessons: Lesson[],
  pending: { entityId: string; payload: Record<string, unknown> }[],
): Lesson[] {
  if (!pending.length) return lessons;
  return lessons.map((l) => {
    const mine = pending.filter((w) => w.entityId === l.id);
    if (!mine.length) return l;
    return mine.reduce<Lesson>((acc, w) => ({ ...acc, ...lessonFieldsOf(w.payload) }), l);
  });
}
