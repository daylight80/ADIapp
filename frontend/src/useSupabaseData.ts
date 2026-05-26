// React hooks for the Supabase data layer.
// These wrap supabaseDb functions with loading/error states and a global
// invalidation counter so any mutation refreshes all student-list consumers.

import { useCallback, useEffect, useState } from 'react';
import * as db from './supabaseDb';

// ---------------------------------------------------------------------------
// Tiny invalidation hub. After a write (add/update/delete/passed) we bump the
// counter so every useStudents/useStudent subscriber refetches.
// ---------------------------------------------------------------------------

let _version = 0;
const _listeners = new Set<() => void>();
function bump() {
  _version += 1;
  _listeners.forEach((l) => l());
}
function useVersion(): number {
  const [, setN] = useState(0);
  useEffect(() => {
    const onChange = () => setN((n) => n + 1);
    _listeners.add(onChange);
    return () => {
      _listeners.delete(onChange);
    };
  }, []);
  return _version;
}

// ---------------------------------------------------------------------------
// Hooks — Students
// ---------------------------------------------------------------------------

export function useStudents() {
  const version = useVersion();
  const [students, setStudents] = useState<db.Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await db.listStudents();
      setStudents(rows);
    } catch (e: any) {
      setError(e?.message || 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  return { students, loading, error, refresh };
}

export function useStudent(id: string | undefined) {
  const version = useVersion();
  const [student, setStudent] = useState<db.Student | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setStudent(await db.getStudent(id));
    } catch (e: any) {
      setError(e?.message || 'Failed to load student');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  return { student, loading, error, refresh };
}

// ---------------------------------------------------------------------------
// Mutations — wrap supabaseDb calls + auto-invalidate
// ---------------------------------------------------------------------------

export async function createStudent(input: db.AddStudentInput) {
  const row = await db.addStudent(input);
  bump();
  return row;
}

export async function patchStudent(id: string, patch: db.UpdateStudentInput) {
  const row = await db.updateStudent(id, patch);
  bump();
  return row;
}

export async function passStudent(id: string) {
  const row = await db.markStudentPassed(id);
  bump();
  return row;
}

export async function removeStudent(id: string) {
  const ok = await db.deleteStudent(id);
  bump();
  return ok;
}

export async function ensureDemoStudentsSeeded() {
  const r = await db.seedDemoStudentsIfEmpty();
  if (r.created > 0) bump();
  return r;
}

// ---------------------------------------------------------------------------
// Hooks — Lessons
// ---------------------------------------------------------------------------

export function useLessons() {
  const version = useVersion();
  const [lessons, setLessons] = useState<db.Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLessons(await db.listLessons());
    } catch (e: any) {
      setError(e?.message || 'Failed to load lessons');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  return { lessons, loading, error, refresh };
}

export function useLessonsForStudent(studentId: string | undefined) {
  const version = useVersion();
  const [lessons, setLessons] = useState<db.Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!studentId) {
      setLessons([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setLessons(await db.listLessonsForStudent(studentId));
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  return { lessons, loading, refresh };
}

export function useLessonsForWeek(weekStart: Date) {
  const version = useVersion();
  const key = weekStart.toISOString().slice(0, 10);
  const [lessons, setLessons] = useState<db.Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const from = new Date(weekStart);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    setLoading(true);
    db.listLessonsBetween(from.toISOString(), to.toISOString())
      .then(setLessons)
      .catch(() => setLessons([]))
      .finally(() => setLoading(false));
  }, [key, version]);

  return { lessons, loading };
}

// ---------------------------------------------------------------------------
// Lesson mutations
// ---------------------------------------------------------------------------

export async function createLesson(input: db.AddLessonInput) {
  const row = await db.addLesson(input);
  bump();
  return row;
}

export async function patchLesson(id: string, patch: db.UpdateLessonInput) {
  const row = await db.updateLesson(id, patch);
  bump();
  return row;
}

export async function cancelLesson(id: string) {
  const row = await db.updateLesson(id, { status: 'Cancelled' });
  bump();
  return row;
}

export async function removeLesson(id: string) {
  const ok = await db.deleteLesson(id);
  bump();
  return ok;
}

// ---------------------------------------------------------------------------
// Hooks — Competencies, Reflective Logs, Badges, Block Bookings
// ---------------------------------------------------------------------------

export function useCompetencies(studentId: string | undefined) {
  const version = useVersion();
  const [items, setItems] = useState<db.Competency[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        await db.seedCompetenciesIfEmpty(studentId);
        setItems(await db.listCompetencies(studentId));
      } finally {
        setLoading(false);
      }
    })();
  }, [studentId, version]);

  return { competencies: items, loading };
}

export async function updateCompetency(
  studentId: string,
  category_key: string,
  patch: { level?: number; progress?: number; notes?: string },
) {
  const row = await db.upsertCompetency(studentId, category_key, patch);
  bump();
  return row;
}

export function useReflectiveLogs(studentId: string | undefined) {
  const version = useVersion();
  const [logs, setLogs] = useState<db.ReflectiveLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) { setLogs([]); setLoading(false); return; }
    setLoading(true);
    db.listReflectiveLogs(studentId)
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [studentId, version]);

  return { logs, loading };
}

export async function createReflectiveLog(input: Parameters<typeof db.addReflectiveLog>[0]) {
  const row = await db.addReflectiveLog(input);
  bump();
  return row;
}

export function useBadges(studentId: string | undefined) {
  const version = useVersion();
  const [badges, setBadges] = useState<db.Badge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) { setBadges([]); setLoading(false); return; }
    setLoading(true);
    db.listBadges(studentId)
      .then(setBadges)
      .catch(() => setBadges([]))
      .finally(() => setLoading(false));
  }, [studentId, version]);

  return { badges, loading };
}

export function useBlockBookings(studentId: string | undefined) {
  const version = useVersion();
  const [bookings, setBookings] = useState<db.BlockBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) { setBookings([]); setLoading(false); return; }
    setLoading(true);
    db.listBlockBookings(studentId)
      .then(setBookings)
      .catch(() => setBookings([]))
      .finally(() => setLoading(false));
  }, [studentId, version]);

  return { bookings, loading };
}

export async function purchaseBlock(input: Parameters<typeof db.addBlockBooking>[0]) {
  const row = await db.addBlockBooking(input);
  bump();
  return row;
}

// ---------------------------------------------------------------------------
// Student lookup (used by the new Student Home screen)
// ---------------------------------------------------------------------------

export function useStudentByEmail(email: string | undefined) {
  const version = useVersion();
  const [student, setStudent] = useState<db.Student | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email) { setStudent(undefined); setLoading(false); return; }
    setLoading(true);
    db.getStudentByEmail(email)
      .then(setStudent)
      .catch(() => setStudent(undefined))
      .finally(() => setLoading(false));
  }, [email, version]);

  return { student, loading };
}
