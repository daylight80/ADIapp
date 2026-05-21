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
