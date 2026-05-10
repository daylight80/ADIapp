// Mock data store - structured for easy Supabase swap.
// All entities use UUID-like strings; timestamps as ISO strings.

export type StudentStatus = 'New' | 'Active' | 'Test Ready';

export type Student = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  status: StudentStatus;
  progress: number; // 0-100
  lessons_count: number;
  next_lesson?: string; // ISO
  test_date?: string; // ISO
  hourly_rate: number; // GBP
  avatar?: string;
  joined_at: string;
};

export type Lesson = {
  id: string;
  student_id: string;
  date: string; // ISO date
  start_time: string; // "HH:mm"
  end_time: string; // "HH:mm"
  duration_hours: number;
  topic: string;
  notes?: string;
  driving_faults: number;
  serious_faults: number;
  dangerous_faults: number;
  grade?: number; // 1-5
  amount_paid?: number;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
};

export type CompetencyCategory = {
  key: string;
  name: string;
  icon: string;
  level: number; // 1-5
  progress: number; // 0-100
  skills: { name: string; level: number; progress: number }[];
};

// 12 DVSA categories
export const DVSA_CATEGORIES_BASE = [
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
];

const today = new Date();
const iso = (d: Date) => d.toISOString();
const addDays = (d: Date, days: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
};

// Seed students
let _students: Student[] = [
  {
    id: 's1',
    name: 'Sophie Carter',
    email: 'sophie.carter@example.co.uk',
    phone: '07700 900111',
    address: '12 Abbey Road',
    postcode: 'NW8 9AY',
    status: 'Test Ready',
    progress: 86,
    lessons_count: 28,
    next_lesson: iso(addDays(today, 1)),
    test_date: iso(addDays(today, 14)),
    hourly_rate: 38,
    joined_at: iso(addDays(today, -120)),
  },
  {
    id: 's2',
    name: 'Jamie Williams',
    email: 'student@demo.uk',
    phone: '07700 900222',
    address: '45 King Street',
    postcode: 'M2 4WQ',
    status: 'Active',
    progress: 62,
    lessons_count: 18,
    next_lesson: iso(addDays(today, 2)),
    hourly_rate: 36,
    joined_at: iso(addDays(today, -75)),
  },
  {
    id: 's3',
    name: 'Oliver Bennett',
    email: 'oliver.b@example.co.uk',
    phone: '07700 900333',
    address: '88 High Street',
    postcode: 'BS1 3AB',
    status: 'Active',
    progress: 48,
    lessons_count: 12,
    next_lesson: iso(addDays(today, 0)),
    hourly_rate: 36,
    joined_at: iso(addDays(today, -55)),
  },
  {
    id: 's4',
    name: 'Amelia Hughes',
    email: 'amelia.h@example.co.uk',
    phone: '07700 900444',
    address: '7 Park Lane',
    postcode: 'LS1 5RR',
    status: 'New',
    progress: 8,
    lessons_count: 2,
    next_lesson: iso(addDays(today, 3)),
    hourly_rate: 36,
    joined_at: iso(addDays(today, -10)),
  },
  {
    id: 's5',
    name: 'Harry Patel',
    email: 'harry.p@example.co.uk',
    phone: '07700 900555',
    address: '23 Mill Lane',
    postcode: 'B5 7TG',
    status: 'Active',
    progress: 71,
    lessons_count: 22,
    next_lesson: iso(addDays(today, 4)),
    hourly_rate: 38,
    joined_at: iso(addDays(today, -95)),
  },
];

// Lessons (some today, some this week)
let _lessons: Lesson[] = [
  {
    id: 'l1',
    student_id: 's3',
    date: iso(today).slice(0, 10),
    start_time: '09:00',
    end_time: '11:00',
    duration_hours: 2,
    topic: 'Roundabouts & Junctions',
    notes: 'Worked on mini-roundabouts at Mill Lane.',
    driving_faults: 3,
    serious_faults: 0,
    dangerous_faults: 0,
    grade: 4,
    amount_paid: 72,
    status: 'Scheduled',
  },
  {
    id: 'l2',
    student_id: 's1',
    date: iso(today).slice(0, 10),
    start_time: '13:00',
    end_time: '15:00',
    duration_hours: 2,
    topic: 'Mock Test Practice',
    notes: 'Final preparation; full route.',
    driving_faults: 1,
    serious_faults: 0,
    dangerous_faults: 0,
    grade: 5,
    amount_paid: 76,
    status: 'Scheduled',
  },
  {
    id: 'l3',
    student_id: 's2',
    date: iso(today).slice(0, 10),
    start_time: '16:00',
    end_time: '17:30',
    duration_hours: 1.5,
    topic: 'Manoeuvres - Parallel Park',
    notes: 'Improving spatial awareness.',
    driving_faults: 2,
    serious_faults: 1,
    dangerous_faults: 0,
    grade: 3,
    amount_paid: 54,
    status: 'Scheduled',
  },
  {
    id: 'l4',
    student_id: 's2',
    date: iso(addDays(today, -2)).slice(0, 10),
    start_time: '10:00',
    end_time: '12:00',
    duration_hours: 2,
    topic: 'Dual Carriageways',
    driving_faults: 2,
    serious_faults: 0,
    dangerous_faults: 0,
    grade: 4,
    amount_paid: 72,
    status: 'Completed',
  },
  {
    id: 'l5',
    student_id: 's2',
    date: iso(addDays(today, -5)).slice(0, 10),
    start_time: '14:00',
    end_time: '15:30',
    duration_hours: 1.5,
    topic: 'Pedestrian Crossings',
    driving_faults: 1,
    serious_faults: 0,
    dangerous_faults: 0,
    grade: 4,
    amount_paid: 54,
    status: 'Completed',
  },
  {
    id: 'l6',
    student_id: 's2',
    date: iso(addDays(today, -8)).slice(0, 10),
    start_time: '11:00',
    end_time: '13:00',
    duration_hours: 2,
    topic: 'Use of Speed',
    driving_faults: 3,
    serious_faults: 0,
    dangerous_faults: 0,
    grade: 3,
    amount_paid: 72,
    status: 'Completed',
  },
  {
    id: 'l7',
    student_id: 's1',
    date: iso(addDays(today, 1)).slice(0, 10),
    start_time: '10:00',
    end_time: '12:00',
    duration_hours: 2,
    topic: 'Test Route Practice',
    driving_faults: 0,
    serious_faults: 0,
    dangerous_faults: 0,
    amount_paid: 76,
    status: 'Scheduled',
  },
  {
    id: 'l8',
    student_id: 's5',
    date: iso(addDays(today, 2)).slice(0, 10),
    start_time: '15:00',
    end_time: '17:00',
    duration_hours: 2,
    topic: 'Awareness & Planning',
    driving_faults: 0,
    serious_faults: 0,
    dangerous_faults: 0,
    amount_paid: 76,
    status: 'Scheduled',
  },
];

// Competencies per student
const _competencies: Record<string, CompetencyCategory[]> = {};

function generateCompetencies(seedOffset: number): CompetencyCategory[] {
  return DVSA_CATEGORIES_BASE.map((c, i) => {
    const lvl = Math.max(1, Math.min(5, Math.round(((i + seedOffset) % 5) + 1)));
    const prog = Math.min(100, lvl * 18 + ((i * 7 + seedOffset) % 10));
    return {
      key: c.key,
      name: c.name,
      icon: c.icon,
      level: lvl,
      progress: prog,
      skills: [
        { name: `${c.name} - Theory`, level: lvl, progress: prog },
        { name: `${c.name} - Practical`, level: Math.max(1, lvl - 1), progress: Math.max(0, prog - 15) },
        { name: `${c.name} - Independent`, level: Math.max(1, lvl - 2), progress: Math.max(0, prog - 30) },
      ],
    };
  });
}

_students.forEach((s, i) => {
  _competencies[s.id] = generateCompetencies(i);
});

// Public API - swap with Supabase later
export const mockDb = {
  // Students
  listStudents: (): Student[] => [..._students].sort((a, b) => {
    if (a.status === 'New' && b.status !== 'New') return -1;
    if (b.status === 'New' && a.status !== 'New') return 1;
    return new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime();
  }),
  getStudent: (id: string): Student | undefined => _students.find((s) => s.id === id),
  getStudentByEmail: (email: string): Student | undefined =>
    _students.find((s) => s.email.toLowerCase() === email.toLowerCase()),
  addStudent: (data: Omit<Student, 'id' | 'status' | 'progress' | 'lessons_count' | 'joined_at' | 'hourly_rate'>) => {
    const newStudent: Student = {
      ...data,
      id: `s${Date.now()}`,
      status: 'New',
      progress: 0,
      lessons_count: 0,
      hourly_rate: 36,
      joined_at: new Date().toISOString(),
    };
    _students = [newStudent, ..._students];
    _competencies[newStudent.id] = generateCompetencies(_students.length);
    return newStudent;
  },

  // Lessons
  listLessons: (): Lesson[] => [..._lessons],
  listLessonsForStudent: (studentId: string): Lesson[] =>
    _lessons.filter((l) => l.student_id === studentId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
  listTodayLessons: (): Lesson[] => {
    const todayStr = iso(today).slice(0, 10);
    return _lessons
      .filter((l) => l.date === todayStr)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  },
  listLessonsForWeek: (weekStart: Date): Lesson[] => {
    const start = iso(weekStart).slice(0, 10);
    const end = iso(addDays(weekStart, 7)).slice(0, 10);
    return _lessons.filter((l) => l.date >= start && l.date < end);
  },
  addLesson: (data: Omit<Lesson, 'id' | 'driving_faults' | 'serious_faults' | 'dangerous_faults' | 'status'>) => {
    const newLesson: Lesson = {
      ...data,
      id: `l${Date.now()}`,
      driving_faults: 0,
      serious_faults: 0,
      dangerous_faults: 0,
      status: 'Scheduled',
    };
    _lessons = [..._lessons, newLesson];
    return newLesson;
  },
  updateLesson: (id: string, patch: Partial<Lesson>) => {
    _lessons = _lessons.map((l) => (l.id === id ? { ...l, ...patch } : l));
    return _lessons.find((l) => l.id === id);
  },

  // Competencies
  getCompetencies: (studentId: string): CompetencyCategory[] =>
    _competencies[studentId] || generateCompetencies(0),
  getCompetency: (studentId: string, key: string): CompetencyCategory | undefined =>
    (_competencies[studentId] || []).find((c) => c.key === key),

  // KPIs
  getKPIs: () => {
    const total = _students.length;
    const active = _students.filter((s) => s.status === 'Active').length;
    const testReady = _students.filter((s) => s.status === 'Test Ready').length;
    const completed = _lessons.filter((l) => l.status === 'Completed').length;
    const passRate = 92;
    return { total, active, testReady, completed, passRate };
  },

  getMTDStats: () => {
    const todayStr = iso(today).slice(0, 10);
    const monthStart = todayStr.slice(0, 7) + '-01';
    const monthLessons = _lessons.filter((l) => l.date >= monthStart && l.status !== 'Cancelled');
    const earnings = monthLessons.reduce((sum, l) => sum + (l.amount_paid || 0), 0);
    return { lessons: monthLessons.length, earnings };
  },

  // Earnings - last 6 months mock
  getEarningsByMonth: () => {
    const months = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
    return months.map((m, i) => ({ month: m, value: 1200 + i * 180 + ((i * 73) % 200) }));
  },
};

export const readiness = {
  criteria: [
    { key: 'lessons', label: 'Minimum 25 lessons', met: true },
    { key: 'mock_test', label: 'Mock test passed', met: true },
    { key: 'theory', label: 'Theory test passed', met: true },
    { key: 'manoeuvres', label: 'All manoeuvres at Level 4+', met: true },
    { key: 'independent', label: 'Independent driving (20 min)', met: false },
  ],
};
