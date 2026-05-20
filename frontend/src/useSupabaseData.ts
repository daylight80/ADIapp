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
