// React hooks for the Supabase data layer.
// These wrap supabaseDb functions with loading/error states and a global
// invalidation counter so any mutation refreshes all student-list consumers.

import { useCallback, useEffect, useState } from 'react';
import * as db from './supabaseDb';
import { supabase } from './supabaseClient';

/**
 * UUID v4 regex used to guard Supabase queries against mockDb sentinel IDs
 * (e.g. `"s4"`, `"s1"`) that would otherwise trigger HTTP 400 responses at
 * PostgREST because `student_id=eq.s4` is not a valid UUID cast. Being strict
 * on the format keeps the browser console clean and cuts pointless traffic.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// ---------------------------------------------------------------------------
// Lifecycle status + hard-delete via the FastAPI v2 endpoints. The /v2 routes
// enforce tenant isolation server-side (see `_ensure_owns_student` in
// `server.py`). Both helpers bump the global cache so every listening hook
// refetches immediately.
// ---------------------------------------------------------------------------

import { updateStudentStatus, deleteStudentHard, type LifecycleStatus } from './studentLifecycle';

export async function setStudentStatusAsync(id: string, status: LifecycleStatus): Promise<LifecycleStatus> {
  const confirmed = await updateStudentStatus(id, status);
  bump();
  return confirmed;
}

export async function removeStudentViaApi(id: string): Promise<void> {
  await deleteStudentHard(id);
  bump();
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
    // Skip when the id is missing OR is a mockDb sentinel like "s4" — the
    // Supabase REST endpoint rejects non-UUID student_id filters with an
    // HTTP 400, which pollutes the browser console for no benefit. UUID v4
    // is 36 chars including hyphens; the sentinel check is deliberately
    // conservative so genuine UUIDs always pass through.
    if (!studentId || !UUID_RE.test(studentId)) {
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

// Same shape as useLessonsForWeek, but for a full 42-day (6-row) month
// grid — gridStart/gridEnd already account for padding days from the
// adjacent months, computed by the caller via startOfMonthGrid/endOfMonthGrid.
export function useLessonsForMonth(gridStart: Date, gridEnd: Date) {
  const version = useVersion();
  const key = `${gridStart.toISOString().slice(0, 10)}_${gridEnd.toISOString().slice(0, 10)}`;
  const [lessons, setLessons] = useState<db.Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    db.listLessonsBetween(gridStart.toISOString(), gridEnd.toISOString())
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
// Recurring series helpers (Migration 016)
// ---------------------------------------------------------------------------

export async function countUpcomingInSeries(seriesId: string, fromIso: string) {
  return db.countUpcomingInSeries(seriesId, fromIso);
}

export async function cancelSeriesFromDate(
  seriesId: string,
  fromIso: string,
  opts?: { charge?: number; note?: string },
) {
  const n = await db.cancelSeriesFromDate(seriesId, fromIso, opts);
  bump();
  return n;
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

export type CompetencyPattern = {
  category_key: string;
  category_name: string;
  studentsStruggling: number;  // competency_level <= 2
  studentsAssessed: number;    // has any record at all for this category
};

// A category counts as "struggling" for a student when their level is 1 or
// 2 out of 5 — ADI Pro doesn't have a separate "at risk" flag, so this is
// a judgment call on what "struggling" means from the same data the
// competency tracker already shows.
const STRUGGLING_LEVEL_MAX = 2;

export function useCompetencyPatterns(studentIds: string[]) {
  const version = useVersion();
  const [patterns, setPatterns] = useState<CompetencyPattern[]>([]);
  const [studentsWithData, setStudentsWithData] = useState(0);
  const [loading, setLoading] = useState(true);

  // Stable key so the effect only re-runs when the actual set of ids
  // changes, not on every render where a new array reference is passed in.
  const idsKey = studentIds.slice().sort().join(',');

  useEffect(() => {
    if (studentIds.length === 0) {
      setPatterns([]);
      setStudentsWithData(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    db.listCompetenciesForStudents(studentIds)
      .then((rows) => {
        const byCategory = new Map<string, { name: string; struggling: Set<string>; assessed: Set<string> }>();
        for (const r of rows) {
          const entry = byCategory.get(r.category_key) || { name: r.category_name, struggling: new Set(), assessed: new Set() };
          entry.assessed.add(r.student_id);
          if (r.level <= STRUGGLING_LEVEL_MAX) entry.struggling.add(r.student_id);
          byCategory.set(r.category_key, entry);
        }
        const result: CompetencyPattern[] = Array.from(byCategory.entries())
          .map(([category_key, v]) => ({
            category_key,
            category_name: v.name,
            studentsStruggling: v.struggling.size,
            studentsAssessed: v.assessed.size,
          }))
          .filter((p) => p.studentsStruggling >= 2)  // a "pattern" needs at least 2 students, not just one
          .sort((a, b) => b.studentsStruggling - a.studentsStruggling);
        setPatterns(result);
        setStudentsWithData(new Set(rows.map((r) => r.student_id)).size);
      })
      .catch(() => { setPatterns([]); setStudentsWithData(0); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, version]);

  return { patterns, studentsWithData, loading };
}

export async function updateCompetency(
  studentId: string,
  category_key: string,
  patch: { level?: number; progress?: number; notes?: string },
) {
  const row = await db.upsertCompetency(studentId, category_key, patch);
  // Auto-award a "Confident: <category>" badge once a learner reaches Level 4+.
  // Gated by tier — Starter plan does NOT get auto-awarded badges (Growth+ only).
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user.id;
    if (uid) {
      const { data } = await supabase
        .from('instructors')
        .select('driving_schools(tier)')
        .eq('auth_user_id', uid)
        .maybeSingle();
      const tier = ((data as any)?.driving_schools?.tier) || 'starter';
      if (tier === 'growth' || tier === 'pro' || tier === 'franchise') {
        await db.maybeAwardCompetencyBadge(studentId, row);
      }
    }
  } catch {
    // never block the competency save on badge minting
  }
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

export function useMockTestAttempts(studentId: string | undefined) {
  const version = useVersion();
  const [attempts, setAttempts] = useState<db.MockTestAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) { setAttempts([]); setLoading(false); return; }
    setLoading(true);
    db.listMockTestAttempts(studentId)
      .then(setAttempts)
      .catch(() => setAttempts([]))
      .finally(() => setLoading(false));
  }, [studentId, version]);

  return { attempts, loading };
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

// Resolve a student row from a Supabase Auth uid (post Migration 004).
// Used by the student-side app to find "my row" without trusting email casing.
export function useStudentByAuthId(authUserId: string | undefined) {
  const version = useVersion();
  const [student, setStudent] = useState<db.Student | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authUserId) { setStudent(undefined); setLoading(false); return; }
    setLoading(true);
    db.getStudentByAuthId(authUserId)
      .then(setStudent)
      .catch(() => setStudent(undefined))
      .finally(() => setLoading(false));
  }, [authUserId, version]);

  return { student, loading };
}

// ---------------------------------------------------------------------------
// Hooks — Vehicles
// ---------------------------------------------------------------------------

export function useVehicles() {
  const version = useVersion();
  const [vehicles, setVehicles] = useState<db.Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await db.listVehicles();
      setVehicles(rows);
    } catch (e: any) {
      setError(e?.message || 'Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh, version]);
  return { vehicles, loading, error, refresh };
}

export async function createVehicle(input: db.VehicleInput) {
  const v = await db.createVehicle(input);
  bump();
  return v;
}

export async function updateVehicle(id: string, patch: Partial<db.VehicleInput>) {
  const v = await db.updateVehicle(id, patch);
  bump();
  return v;
}

export async function deleteVehicle(id: string) {
  await db.deleteVehicle(id);
  bump();
}

export async function setDefaultVehicle(id: string) {
  await db.setDefaultVehicle(id);
  bump();
}

// ---------------------------------------------------------------------------
// Hooks — Instructor profile (preferred_nav_app etc.)
// ---------------------------------------------------------------------------

export function useInstructorProfile() {
  const version = useVersion();
  const [profile, setProfile] = useState<db.InstructorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    db.getInstructorProfile()
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [version]);

  return { profile, loading };
}

export async function updatePreferredNavApp(app: db.NavApp) {
  await db.updateInstructorPreferredNavApp(app);
  bump();
}


// ---------------------------------------------------------------------------
// Hooks — Availability blocks (Migration 013)
// ---------------------------------------------------------------------------

/**
 * Subscribe to all availability blocks that overlap a date window
 * (e.g. the visible week on the Diary screen). `from` and `to` are local
 * Date objects; we convert to ISO before querying. Re-fetches on every
 * mutation (add/update/delete) thanks to the shared `bump()` channel.
 */
export function useAvailabilityBlocks(from: Date | null, to: Date | null) {
  const version = useVersion();
  const [blocks, setBlocks] = useState<db.AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fromIso = from ? from.toISOString() : undefined;
  const toIso = to ? to.toISOString() : undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    db.listAvailabilityBlocks(fromIso, toIso)
      .then((rows) => { if (!cancelled) setBlocks(rows); })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Failed to load unavailabilities'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fromIso, toIso, version]);

  return { blocks, loading, error };
}

export async function createAvailabilityBlock(input: db.AddAvailabilityBlockInput) {
  const row = await db.addAvailabilityBlock(input);
  bump();
  return row;
}

export async function patchAvailabilityBlock(id: string, patch: Partial<db.AddAvailabilityBlockInput>) {
  const row = await db.updateAvailabilityBlock(id, patch);
  bump();
  return row;
}

export async function removeAvailabilityBlock(id: string) {
  await db.deleteAvailabilityBlock(id);
  bump();
}

// ---------------------------------------------------------------------------
// Hooks — Test outcomes (Migration 015)
// ---------------------------------------------------------------------------

export function useTestOutcomesForStudent(studentId?: string | null) {
  const version = useVersion();
  const [rows, setRows] = useState<db.TestOutcome[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!studentId || !UUID_RE.test(studentId)) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    db.listTestOutcomesForStudent(studentId)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [studentId, version]);
  return { rows, loading };
}

export function useInstructorTestOutcomes() {
  const version = useVersion();
  const [rows, setRows] = useState<db.TestOutcome[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    db.listTestOutcomesForInstructor()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version]);
  return { rows, loading };
}

export async function createTestOutcome(input: db.AddTestOutcomeInput) {
  const row = await db.addTestOutcome(input);
  bump();
  return row;
}

export async function removeTestOutcome(id: string) {
  await db.deleteTestOutcome(id);
  bump();
}

// ===========================================================================
// Real instructor home-screen figures (23 Aug 2026) — these replace the
// mockDb.getKPIs() / getMTDStats() / listTodayLessons() / getEarningsByMonth()
// calls the home screen was still using, which showed hardcoded demo numbers
// rather than the signed-in instructor's actual data.
// ===========================================================================

export type MonthEarning = { label: string; value: number };

/**
 * Month-to-date totals plus a trailing 6-month earnings series, both derived
 * from real lessons. "Earned" counts amount_paid (money actually taken);
 * "unpaid" counts quoted_amount on completed lessons that have no payment
 * recorded yet — deliberately separate, since conflating them would
 * overstate income.
 */
export function useInstructorEarnings() {
  const version = useVersion();
  const [mtdEarned, setMtdEarned] = useState(0);
  const [mtdUnpaid, setMtdUnpaid] = useState(0);
  const [mtdLessonCount, setMtdLessonCount] = useState(0);
  const [byMonth, setByMonth] = useState<MonthEarning[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const now = new Date();
        const seriesStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        const seriesEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const rows = await db.listLessonsBetween(seriesStart.toISOString(), seriesEnd.toISOString());
        if (cancelled) return;

        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        let earned = 0;
        let unpaid = 0;
        let count = 0;
        const buckets = new Map<string, number>();
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          buckets.set(`${d.getFullYear()}-${d.getMonth()}`, 0);
        }

        for (const l of rows) {
          const d = new Date(`${l.date}T00:00:00`);
          const key = `${d.getFullYear()}-${d.getMonth()}`;
          if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + (l.amount_paid || 0));
          if (d >= monthStart) {
            earned += l.amount_paid || 0;
            count += 1;
            if (!l.amount_paid && l.status === 'Completed') unpaid += l.quoted_amount || 0;
          }
        }

        setMtdEarned(earned);
        setMtdUnpaid(unpaid);
        setMtdLessonCount(count);
        setByMonth(
          Array.from(buckets.entries()).map(([key, value]) => {
            const [y, m] = key.split('-').map(Number);
            return { label: new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'short' }), value };
          }),
        );
      } catch {
        if (!cancelled) { setMtdEarned(0); setMtdUnpaid(0); setMtdLessonCount(0); setByMonth([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [version]);

  return { mtdEarned, mtdUnpaid, mtdLessonCount, byMonth, loading };
}

/** Today's lessons only, from real data. */
export function useTodayLessons() {
  const version = useVersion();
  const [lessons, setLessons] = useState<db.Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(end.getDate() + 1);
        const rows = await db.listLessonsBetween(start.toISOString(), end.toISOString());
        if (!cancelled) setLessons(rows);
      } catch {
        if (!cancelled) setLessons([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [version]);

  return { lessons, loading };
}
