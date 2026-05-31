// ============================================================================
// mockDb.ts — READ-ONLY DEMO SEED (HARD-DEPRECATED)
// ----------------------------------------------------------------------------
// As of Wave 3, all live writes go through Supabase via /app/frontend/src/
// supabaseDb.ts. This file is now strictly a read-only seed module retained
// only to support unauthenticated demo previews and to keep TypeScript types
// imported by older screens stable while we finish the migration sweep.
//
// What this module STILL exports:
//   • TypeScript types (Student, Lesson, Badge, ReflectiveLog, BlockBooking,
//     TestAttempt, CompetencyCategory, TheoryQ, StudentStatus).
//   • Static reference data: DVSA_CATEGORIES_BASE, THEORY_BANK, readiness,
//     instructorProfile, BADGE_CATALOG, demo students/lessons/competencies.
//   • Pure read accessors on `mockDb` (listStudents, getStudent, listLessons,
//     getCompetencies, getKPIs, getMTDStats, getEarningsByMonth, etc.).
//   • Pure read accessors on `mockDb_ext` (badgeCatalog, getBadges,
//     listReflections, listBlockBookings, getWalletBalance, getTestAttempt,
//     canChangeTest).
//
// What this module NO LONGER does:
//   • Mutations (add / update / delete / mark passed / award) are NO-OPS.
//     They log a single console.warn the first time per session so a developer
//     spots stale fallback paths quickly. They return a best-effort echo of
//     the input (so callers' `.catch(()=>mockDb...)` shims don't crash) but
//     NEVER touch any in-memory store. Persisted data MUST go via Supabase.
//
// To genuinely remove this file, delete the screen-level fallback branches
// (search the repo for `mockDb.` and `mockDb_ext.`) and then this module.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type StudentStatus = 'New' | 'Active' | 'Test Ready' | 'Passed';

export type Student = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  status: StudentStatus;
  progress: number;
  lessons_count: number;
  next_lesson?: string;
  test_date?: string;
  test_passed_at?: string;
  hourly_rate: number;
  avatar?: string;
  joined_at: string;
};

export type Lesson = {
  id: string;
  student_id: string;
  date: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  travel_minutes?: number;
  pickup_address?: string;
  topic: string;
  notes?: string;
  driving_faults: number;
  serious_faults: number;
  dangerous_faults: number;
  grade?: number;
  amount_paid?: number;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  student_reflection?: string;
  pre_check_completed_at?: string;
  // ---- Cancellation audit (Migration 011) --------------------------------
  // When a lesson is cancelled, instructors may apply a full / partial /
  // waived charge. `cancellation_charge` mirrors the £ amount retained and
  // `cancellation_note` stores the human-readable rationale for reports.
  cancellation_charge?: number;
  cancellation_note?: string;
};

export type Badge = { key: string; name: string; description: string; earned_at?: string };

export type ReflectiveLog = {
  id: string;
  lesson_id: string;
  student_id: string;
  text: string;
  created_at: string;
};

export type BlockBooking = {
  id: string;
  student_id: string;
  hours: number;
  amount: number;
  purchased_at: string;
  hours_used: number;
};

export type TestAttempt = {
  id: string;
  student_id: string;
  scheduled_for: string;
  changed_count: number;
  test_centre?: string;
};

export type CompetencyCategory = {
  key: string;
  name: string;
  icon: string;
  level: number;
  progress: number;
  skills: { name: string; level: number; progress: number }[];
  notes?: string;
  assessed_at?: string;
};

export type TheoryQ = {
  id: string;
  question: string;
  options: string[];
  answer_index: number;
  topic: string;
};

// ---------------------------------------------------------------------------
// Static reference data (READ-ONLY)
// ---------------------------------------------------------------------------
export const DVSA_CATEGORIES_BASE = Object.freeze([
  { key: 'controls', name: 'Controls', icon: 'settings' },
  { key: 'move_off_stop', name: 'Move off / Stop', icon: 'play' },
  { key: 'mirrors', name: 'Mirrors', icon: 'eye' },
  { key: 'signals', name: 'Signals', icon: 'radio' },
  { key: 'junctions', name: 'Junctions', icon: 'git-branch' },
  { key: 'roundabouts', name: 'Roundabouts', icon: 'rotate-cw' },
  { key: 'pedestrian_crossings', name: 'Pedestrian Crossings', icon: 'users' },
  { key: 'manoeuvres', name: 'Manoeuvres', icon: 'move' },
  { key: 'reversing', name: 'Reversing', icon: 'corner-up-left' },
  { key: 'awareness_planning', name: 'Awareness & Planning', icon: 'compass' },
  { key: 'use_of_speed', name: 'Use of Speed', icon: 'gauge' },
  { key: 'other_road_users', name: 'Other Road Users', icon: 'car' },
] as const);

export const THEORY_BANK: TheoryQ[] = Object.freeze([
  { id: 't1', topic: 'Signs', question: 'A red circle with a white horizontal bar means…', options: ['No entry', 'No overtaking', 'Stop', 'Roundabout ahead'], answer_index: 0 },
  { id: 't2', topic: 'Speed', question: 'The national speed limit on a single carriageway for a car is…', options: ['50 mph', '60 mph', '70 mph', '40 mph'], answer_index: 1 },
  { id: 't3', topic: 'Safety', question: 'In good conditions, the typical stopping distance at 60 mph is…', options: ['36 metres', '53 metres', '73 metres', '96 metres'], answer_index: 2 },
  { id: 't4', topic: 'Manoeuvres', question: 'Before reversing into a parking bay you should…', options: ['Sound the horn', 'Check all-round, including blind spots', 'Switch on the hazard lights', 'Open the door to look'], answer_index: 1 },
  { id: 't5', topic: 'Junctions', question: 'You approach a roundabout. You should give way to traffic from the…', options: ['Left', 'Right', 'Both directions', 'Whoever is largest'], answer_index: 1 },
  { id: 't6', topic: 'Pedestrians', question: 'At a zebra crossing you must…', options: ['Wave pedestrians across', 'Stop only if they step out', 'Give way to pedestrians on the crossing', 'Use your horn'], answer_index: 2 },
  { id: 't7', topic: 'Eyesight', question: 'You must be able to read a number plate from…', options: ['10 metres', '15 metres', '20 metres', '30 metres'], answer_index: 2 },
  { id: 't8', topic: 'Signs', question: 'A triangular sign with a red border means…', options: ['Prohibition', 'Warning', 'Information', 'Order'], answer_index: 1 },
  { id: 't9', topic: 'Roads', question: 'In wet weather, stopping distances are at least…', options: ['Twice the normal', 'The same', 'Three times the normal', 'Four times the normal'], answer_index: 0 },
  { id: 't10', topic: 'Alcohol', question: 'The legal blood-alcohol limit for driving in England is…', options: ['50 mg/100 ml', '80 mg/100 ml', '100 mg/100 ml', 'Zero'], answer_index: 1 },
]) as unknown as TheoryQ[];

export const readiness = Object.freeze({
  criteria: [
    { key: 'lessons', label: 'Minimum 25 lessons', met: true },
    { key: 'mock_test', label: 'Mock test passed', met: true },
    { key: 'theory', label: 'Theory test passed', met: true },
    { key: 'manoeuvres', label: 'All manoeuvres at Level 4+', met: true },
    { key: 'independent', label: 'Independent driving (20 min)', met: false },
  ],
});

const BADGE_CATALOG: Badge[] = Object.freeze([
  { key: 'first_lesson', name: 'First Gear', description: 'Completed your first lesson' },
  { key: 'mirror_master', name: 'Mirror Master', description: '5 lessons with zero mirror faults' },
  { key: 'parallel_park_pro', name: 'Parallel Park Pro', description: 'Manoeuvres at Level 4+' },
  { key: 'roundabout_ranger', name: 'Roundabout Ranger', description: 'Roundabouts at Level 4+' },
  { key: 'theory_passed', name: 'Theory Champion', description: 'Passed an in-app theory test' },
  { key: 'mock_passed', name: 'Mock Marvel', description: 'Passed a DL25 mock test' },
]) as unknown as Badge[];

// ---------------------------------------------------------------------------
// Demo seed students/lessons/competencies (READ-ONLY snapshot)
// ---------------------------------------------------------------------------
const today = new Date();
const iso = (d: Date) => d.toISOString();
const addDays = (d: Date, days: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
};

const SEED_STUDENTS: Student[] = [
  { id: 's1', name: 'Sophie Carter',  email: 'sophie.carter@example.co.uk', phone: '07700 900111', address: '12 Abbey Road',  postcode: 'NW8 9AY', status: 'Test Ready', progress: 86, lessons_count: 28, next_lesson: iso(addDays(today, 1)), test_date: iso(addDays(today, 14)), hourly_rate: 38, joined_at: iso(addDays(today, -120)) },
  { id: 's2', name: 'Jamie Williams', email: 'student@demo.uk',             phone: '07700 900222', address: '45 King Street', postcode: 'M2 4WQ', status: 'Active',     progress: 62, lessons_count: 18, next_lesson: iso(addDays(today, 2)),                                       hourly_rate: 36, joined_at: iso(addDays(today, -75)) },
  { id: 's3', name: 'Oliver Bennett', email: 'oliver.b@example.co.uk',      phone: '07700 900333', address: '88 High Street', postcode: 'BS1 3AB', status: 'Active',     progress: 48, lessons_count: 12, next_lesson: iso(addDays(today, 0)),                                       hourly_rate: 36, joined_at: iso(addDays(today, -55)) },
  { id: 's4', name: 'Amelia Hughes',  email: 'amelia.h@example.co.uk',      phone: '07700 900444', address: '7 Park Lane',    postcode: 'LS1 5RR', status: 'New',        progress:  8, lessons_count:  2, next_lesson: iso(addDays(today, 3)),                                       hourly_rate: 36, joined_at: iso(addDays(today, -10)) },
  { id: 's5', name: 'Harry Patel',    email: 'harry.p@example.co.uk',       phone: '07700 900555', address: '23 Mill Lane',   postcode: 'B5 7TG',  status: 'Active',     progress: 71, lessons_count: 22, next_lesson: iso(addDays(today, 4)),                                       hourly_rate: 38, joined_at: iso(addDays(today, -95)) },
];

const weekMonday = (() => {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
})();
const weekDate = (offset: number) => iso(addDays(weekMonday, offset)).slice(0, 10);

const SEED_LESSONS: Lesson[] = [
  { id: 'l1', student_id: 's3', date: weekDate(1), start_time: '09:00', end_time: '11:00', duration_hours: 2,   travel_minutes: 20, pickup_address: '88 High Street, Bristol, BS1 3AB',    topic: 'Roundabouts & Junctions',     notes: 'Worked on mini-roundabouts at Mill Lane.', driving_faults: 3, serious_faults: 0, dangerous_faults: 0, grade: 4, amount_paid: 72, status: 'Scheduled' },
  { id: 'l2', student_id: 's1', date: weekDate(2), start_time: '13:00', end_time: '15:00', duration_hours: 2,   travel_minutes: 15, pickup_address: '12 Abbey Road, London, NW8 9AY',      topic: 'Mock Test Practice',          notes: 'Final preparation; full route.',          driving_faults: 1, serious_faults: 0, dangerous_faults: 0, grade: 5, amount_paid: 76, status: 'Scheduled' },
  { id: 'l3', student_id: 's2', date: weekDate(3), start_time: '16:00', end_time: '17:30', duration_hours: 1.5, travel_minutes: 10, pickup_address: '45 King Street, Manchester, M2 4WQ', topic: 'Manoeuvres - Parallel Park',  notes: 'Improving spatial awareness.',            driving_faults: 2, serious_faults: 1, dangerous_faults: 0, grade: 3, amount_paid: 54, status: 'Scheduled' },
  { id: 'l4', student_id: 's2', date: iso(addDays(today, -2)).slice(0, 10), start_time: '10:00', end_time: '12:00', duration_hours: 2,   topic: 'Dual Carriageways',  driving_faults: 2, serious_faults: 0, dangerous_faults: 0, grade: 4, amount_paid: 72, status: 'Completed' },
  { id: 'l5', student_id: 's2', date: iso(addDays(today, -5)).slice(0, 10), start_time: '14:00', end_time: '15:30', duration_hours: 1.5, topic: 'Pedestrian Crossings', driving_faults: 1, serious_faults: 0, dangerous_faults: 0, grade: 4, amount_paid: 54, status: 'Completed' },
  { id: 'l6', student_id: 's2', date: iso(addDays(today, -8)).slice(0, 10), start_time: '11:00', end_time: '13:00', duration_hours: 2,   topic: 'Use of Speed',       driving_faults: 3, serious_faults: 0, dangerous_faults: 0, grade: 3, amount_paid: 72, status: 'Completed' },
  { id: 'l7', student_id: 's1', date: iso(addDays(today, 1)).slice(0, 10),  start_time: '10:00', end_time: '12:00', duration_hours: 2,   topic: 'Test Route Practice', driving_faults: 0, serious_faults: 0, dangerous_faults: 0, amount_paid: 76, status: 'Scheduled' },
  { id: 'l8', student_id: 's5', date: iso(addDays(today, 2)).slice(0, 10),  start_time: '15:00', end_time: '17:00', duration_hours: 2,   topic: 'Awareness & Planning', driving_faults: 0, serious_faults: 0, dangerous_faults: 0, amount_paid: 76, status: 'Scheduled' },
];

const SEED_COMPETENCIES: Record<string, CompetencyCategory[]> = {};
const generateCompetencies = (seedOffset: number): CompetencyCategory[] =>
  DVSA_CATEGORIES_BASE.map((c, i) => {
    const lvl = Math.max(1, Math.min(5, Math.round(((i + seedOffset) % 5) + 1)));
    const prog = Math.min(100, lvl * 18 + ((i * 7 + seedOffset) % 10));
    return {
      key: c.key,
      name: c.name,
      icon: c.icon,
      level: lvl,
      progress: prog,
      skills: [
        { name: `${c.name} - Theory`,      level: lvl,                       progress: prog },
        { name: `${c.name} - Practical`,   level: Math.max(1, lvl - 1),      progress: Math.max(0, prog - 15) },
        { name: `${c.name} - Independent`, level: Math.max(1, lvl - 2),      progress: Math.max(0, prog - 30) },
      ],
    };
  });
SEED_STUDENTS.forEach((s, i) => { SEED_COMPETENCIES[s.id] = generateCompetencies(i); });

// ---------------------------------------------------------------------------
// Deprecation helper — logs once per session per method.
// ---------------------------------------------------------------------------
const _warned = new Set<string>();
function deprecated(method: string): void {
  if (_warned.has(method)) return;
  _warned.add(method);
  // eslint-disable-next-line no-console
  console.warn(
    `[mockDb] ${method}() is deprecated. mockDb is now READ-ONLY seed data — ` +
    `route all writes through /app/frontend/src/supabaseDb.ts instead.`,
  );
}

// ---------------------------------------------------------------------------
// Public read-only API.  All writes are NO-OPs that return a best-effort
// echo of the input so legacy `.catch(() => mockDb.update…)` shims don't crash.
// ---------------------------------------------------------------------------
export const mockDb = {
  // ---- Reads (real seed data) ---------------------------------------------
  listStudents: (): Student[] => [...SEED_STUDENTS].sort((a, b) => {
    if (a.status === 'New' && b.status !== 'New') return -1;
    if (b.status === 'New' && a.status !== 'New') return 1;
    return new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime();
  }),
  getStudent: (id: string): Student | undefined => SEED_STUDENTS.find((s) => s.id === id),
  getStudentByEmail: (email: string): Student | undefined =>
    SEED_STUDENTS.find((s) => s.email.toLowerCase() === email.toLowerCase()),

  listLessons: (): Lesson[] => [...SEED_LESSONS],
  listLessonsForStudent: (studentId: string): Lesson[] =>
    SEED_LESSONS.filter((l) => l.student_id === studentId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
  listTodayLessons: (): Lesson[] => {
    const todayStr = iso(today).slice(0, 10);
    return SEED_LESSONS
      .filter((l) => l.date === todayStr)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  },
  listLessonsForWeek: (weekStart: Date): Lesson[] => {
    const start = iso(weekStart).slice(0, 10);
    const end = iso(addDays(weekStart, 7)).slice(0, 10);
    return SEED_LESSONS.filter((l) => l.date >= start && l.date < end);
  },

  getCompetencies: (studentId: string): CompetencyCategory[] =>
    SEED_COMPETENCIES[studentId] || generateCompetencies(0),
  getCompetency: (studentId: string, key: string): CompetencyCategory | undefined =>
    (SEED_COMPETENCIES[studentId] || []).find((c) => c.key === key),

  getKPIs: () => {
    const total = SEED_STUDENTS.length;
    const active = SEED_STUDENTS.filter((s) => s.status === 'Active').length;
    const testReady = SEED_STUDENTS.filter((s) => s.status === 'Test Ready').length;
    const completed = SEED_LESSONS.filter((l) => l.status === 'Completed').length;
    const passRate = 92;
    return { total, active, testReady, completed, passRate };
  },
  getMTDStats: () => {
    const todayStr = iso(today).slice(0, 10);
    const monthStart = todayStr.slice(0, 7) + '-01';
    const monthLessons = SEED_LESSONS.filter((l) => l.date >= monthStart && l.status !== 'Cancelled');
    const earnings = monthLessons.reduce((sum, l) => sum + (l.amount_paid || 0), 0);
    return { lessons: monthLessons.length, earnings };
  },
  getEarningsByMonth: () => {
    const months = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
    return months.map((m, i) => ({ month: m, value: 1200 + i * 180 + ((i * 73) % 200) }));
  },

  // ---- Writes (NO-OP / DEPRECATED) ----------------------------------------
  addStudent: (data: Partial<Student>): Student => {
    deprecated('mockDb.addStudent');
    return {
      id: `mock-${Date.now()}`,
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      address: data.address || '',
      postcode: data.postcode || '',
      status: 'New',
      progress: 0,
      lessons_count: 0,
      hourly_rate: 36,
      joined_at: new Date().toISOString(),
    } as Student;
  },
  updateStudent: (id: string, _patch: Partial<Student>): Student | undefined => {
    deprecated('mockDb.updateStudent');
    return SEED_STUDENTS.find((s) => s.id === id);
  },
  markStudentPassed: (id: string): Student | undefined => {
    deprecated('mockDb.markStudentPassed');
    return SEED_STUDENTS.find((s) => s.id === id);
  },
  deleteStudent: (_id: string): boolean => {
    deprecated('mockDb.deleteStudent');
    return false;
  },
  addLesson: (data: Partial<Lesson>): Lesson => {
    deprecated('mockDb.addLesson');
    return {
      id: `mock-${Date.now()}`,
      student_id: data.student_id || '',
      date: data.date || new Date().toISOString().slice(0, 10),
      start_time: data.start_time || '09:00',
      end_time: data.end_time || '10:00',
      duration_hours: data.duration_hours || 1,
      topic: data.topic || '',
      driving_faults: 0,
      serious_faults: 0,
      dangerous_faults: 0,
      status: 'Scheduled',
    } as Lesson;
  },
  updateLesson: (id: string, _patch: Partial<Lesson>): Lesson | undefined => {
    deprecated('mockDb.updateLesson');
    return SEED_LESSONS.find((l) => l.id === id);
  },
};

// ---------------------------------------------------------------------------
// Extended demo helpers (badges / reflections / wallet / test attempts).
// All reads return seed-derived defaults; all writes are NO-OPs.
// ---------------------------------------------------------------------------
const SEED_BADGES_BY_STUDENT: Record<string, Badge[]> = {};
const computeSeedBadges = (studentId: string): Badge[] => {
  if (SEED_BADGES_BY_STUDENT[studentId]) return SEED_BADGES_BY_STUDENT[studentId];
  const earned: Badge[] = [];
  const lessons = SEED_LESSONS.filter((l) => l.student_id === studentId && l.status === 'Completed');
  if (lessons.length >= 1) earned.push({ ...BADGE_CATALOG[0], earned_at: lessons[0].date });
  const comps = SEED_COMPETENCIES[studentId] || [];
  if (comps.find((c) => c.key === 'mirrors'     && c.level >= 4)) earned.push({ ...BADGE_CATALOG[1], earned_at: new Date().toISOString() });
  if (comps.find((c) => c.key === 'manoeuvres'  && c.level >= 4)) earned.push({ ...BADGE_CATALOG[2], earned_at: new Date().toISOString() });
  if (comps.find((c) => c.key === 'roundabouts' && c.level >= 4)) earned.push({ ...BADGE_CATALOG[3], earned_at: new Date().toISOString() });
  SEED_BADGES_BY_STUDENT[studentId] = earned;
  return earned;
};

export const mockDb_ext = {
  badgeCatalog: (): Badge[] => [...BADGE_CATALOG],
  getBadges: (studentId: string): Badge[] => computeSeedBadges(studentId),

  awardBadge: (_studentId: string, _key: string): void => {
    deprecated('mockDb_ext.awardBadge');
  },

  listReflections: (_studentId: string): ReflectiveLog[] => [],
  addReflection: (lessonId: string, studentId: string, text: string): ReflectiveLog => {
    deprecated('mockDb_ext.addReflection');
    return {
      id: `mock-r-${Date.now()}`,
      lesson_id: lessonId,
      student_id: studentId,
      text,
      created_at: new Date().toISOString(),
    };
  },

  listBlockBookings: (_studentId: string): BlockBooking[] => [],
  addBlockBooking: (studentId: string, hours: number, amount: number): BlockBooking => {
    deprecated('mockDb_ext.addBlockBooking');
    return {
      id: `mock-bb-${Date.now()}`,
      student_id: studentId,
      hours,
      amount,
      purchased_at: new Date().toISOString(),
      hours_used: 0,
    };
  },
  getWalletBalance: (_studentId: string): { hours_remaining: number; total_paid: number } =>
    ({ hours_remaining: 0, total_paid: 0 }),

  getTestAttempt: (_studentId: string): TestAttempt | undefined => undefined,
  setTestAttempt: (studentId: string, date: string, centre?: string): TestAttempt => {
    deprecated('mockDb_ext.setTestAttempt');
    return {
      id: `mock-ta-${Date.now()}`,
      student_id: studentId,
      scheduled_for: date,
      changed_count: 0,
      test_centre: centre,
    };
  },
  canChangeTest: (_studentId: string): { allowed: boolean; remaining: number } =>
    ({ allowed: true, remaining: 2 }),
};

// Per-instructor metadata (deprecated mutable scratch-pad; live values come
// from Supabase `instructors` row via getInstructorProfile()). Kept writable
// only so legacy onboarding/profile screens compile while we finish migrating
// them to Supabase.
export const instructorProfile = {
  adi_number: '123456' as string,
  tc_signed_at: null as string | null,
  tc_signature_name: '' as string,
};
