// Supabase data layer — Wave 3 slice 1: Students.
// This file gradually replaces /app/frontend/src/mockDb.ts. Each function below
// returns Promises and operates against the live `students` / `driving_schools`
// / `instructors` tables. RLS does the multi-tenant scoping automatically.

import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------------
// Types — kept compatible with mockDb so we can swap screens incrementally
// ---------------------------------------------------------------------------

export type StudentStatus = 'New' | 'Active' | 'Test Ready' | 'Passed';

export type Student = {
  id: string;
  school_id: string;
  instructor_id: string;
  name: string;                  // mapped from full_name
  email: string;
  phone: string;
  address: string;
  postcode: string;
  status: StudentStatus;
  progress: number;
  lessons_count: number;
  next_lesson?: string | null;
  test_date?: string | null;
  test_passed_at?: string | null;
  hourly_rate: number;
  avatar?: string | null;
  joined_at: string;
  provisional_licence: string;
};

// Row → app object (renames full_name → name, casts numerics)
const fromRow = (r: any): Student => ({
  id: r.id,
  school_id: r.school_id,
  instructor_id: r.instructor_id,
  name: r.full_name ?? '',
  email: r.email ?? '',
  phone: r.phone ?? '',
  address: r.address ?? '',
  postcode: r.postcode ?? '',
  status: (r.status ?? 'New') as StudentStatus,
  progress: Number(r.progress ?? 0),
  lessons_count: Number(r.lessons_count ?? 0),
  next_lesson: r.next_lesson ?? null,
  test_date: r.test_date ?? null,
  test_passed_at: r.test_passed_at ?? null,
  hourly_rate: Number(r.hourly_rate ?? 36),
  avatar: r.avatar ?? null,
  joined_at: r.joined_at ?? r.created_at ?? new Date().toISOString(),
  provisional_licence: r.provisional_licence ?? '',
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listStudents(): Promise<Student[]> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .order('joined_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(fromRow);
}

export async function getStudent(id: string): Promise<Student | undefined> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : undefined;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Find the school + instructor IDs for the currently signed-in user.
// Used by addStudent — students must always be inserted with the caller's
// school_id and instructor_id so RLS lets the row through.
async function ownContext() {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error('Not signed in');

  const { data: instructor, error } = await supabase
    .from('instructors')
    .select('id, school_id')
    .eq('auth_user_id', uid)
    .maybeSingle();
  if (error) throw error;
  if (!instructor) throw new Error('No instructor profile for current user');
  return { schoolId: instructor.school_id as string, instructorId: instructor.id as string };
}

export type AddStudentInput = {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  postcode?: string;
  provisional_licence: string;
  hourly_rate?: number;
  test_date?: string | null;
};

export async function addStudent(input: AddStudentInput): Promise<Student> {
  const { schoolId, instructorId } = await ownContext();
  const payload = {
    school_id: schoolId,
    instructor_id: instructorId,
    full_name: input.name.trim(),
    email: input.email.trim() || null,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    postcode: input.postcode?.trim().toUpperCase() || null,
    provisional_licence: (input.provisional_licence || '').trim() || 'PENDING',
    hourly_rate: input.hourly_rate ?? 36,
    status: 'New' as StudentStatus,
    progress: 0,
    test_date: input.test_date ?? null,
  };
  const { data, error } = await supabase.from('students').insert(payload).select('*').single();
  if (error) throw error;
  return fromRow(data);
}

export type UpdateStudentInput = Partial<{
  name: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  hourly_rate: number;
  test_date: string | null;
  status: StudentStatus;
  progress: number;
  next_lesson: string | null;
}>;

export async function updateStudent(id: string, patch: UpdateStudentInput): Promise<Student | undefined> {
  const dbPatch: Record<string, any> = {};
  if (patch.name !== undefined) dbPatch.full_name = patch.name;
  if (patch.email !== undefined) dbPatch.email = patch.email || null;
  if (patch.phone !== undefined) dbPatch.phone = patch.phone || null;
  if (patch.address !== undefined) dbPatch.address = patch.address || null;
  if (patch.postcode !== undefined) dbPatch.postcode = patch.postcode?.toUpperCase() || null;
  if (patch.hourly_rate !== undefined) dbPatch.hourly_rate = patch.hourly_rate;
  if (patch.test_date !== undefined) dbPatch.test_date = patch.test_date;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.progress !== undefined) dbPatch.progress = patch.progress;
  if (patch.next_lesson !== undefined) dbPatch.next_lesson = patch.next_lesson;

  const { data, error } = await supabase
    .from('students')
    .update(dbPatch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : undefined;
}

export async function markStudentPassed(id: string): Promise<Student | undefined> {
  const { data, error } = await supabase
    .from('students')
    .update({
      status: 'Passed' as StudentStatus,
      progress: 100,
      test_passed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : undefined;
}

export async function deleteStudent(id: string): Promise<boolean> {
  const { error } = await supabase.from('students').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ---------------------------------------------------------------------------
// Demo seeding — creates a small set of UK driving-school demo students for
// the freshly-logged-in instructor if their table is empty. Idempotent.
// ---------------------------------------------------------------------------

const DEMO_STUDENTS: Omit<AddStudentInput, 'provisional_licence'>[] = [
  { name: 'Sophie Carter',   email: 'sophie.carter@example.co.uk',   phone: '07700 900111', address: '12 Abbey Road',     postcode: 'NW8 9AY',  hourly_rate: 38, test_date: new Date(Date.now() + 14 * 86400_000).toISOString() },
  { name: 'Oliver Bennett',  email: 'oliver.bennett@example.co.uk',  phone: '07700 900222', address: '42 Pickwick Avenue', postcode: 'NW1 2AB',  hourly_rate: 36 },
  { name: 'Jamie Williams',  email: 'jamie.w@example.co.uk',         phone: '07700 900333', address: '7 Camden High St',   postcode: 'NW1 0LU',  hourly_rate: 36 },
  { name: 'Amelia Hughes',   email: 'amelia.hughes@example.co.uk',   phone: '07700 900444', address: '88 King\u2019s Cross',     postcode: 'N1 9AL',   hourly_rate: 38 },
];

export async function seedDemoStudentsIfEmpty(): Promise<{ created: number }> {
  const existing = await listStudents();
  if (existing.length > 0) return { created: 0 };
  let created = 0;
  for (const s of DEMO_STUDENTS) {
    try {
      await addStudent({ ...s, provisional_licence: 'CARTE901071SC9AB' });
      created += 1;
    } catch (e) {
      // ignore individual failures (e.g. unique constraint)
      // eslint-disable-next-line no-console
      console.warn('[seedDemoStudents] insert failed', e);
    }
  }
  return { created };
}

// =============================================================================
// VEHICLES (Slice 2 prerequisite)
// =============================================================================

export type Vehicle = {
  id: string;
  school_id: string;
  make_and_model: string;
  registration_plate: string;
  transmission: 'Manual' | 'Automatic' | 'Electric';
  is_right_hand_drive: boolean;
};

const vehicleFromRow = (r: any): Vehicle => ({
  id: r.id,
  school_id: r.school_id,
  make_and_model: r.make_and_model,
  registration_plate: r.registration_plate,
  transmission: r.transmission,
  is_right_hand_drive: r.is_right_hand_drive,
});

export async function listVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase.from('vehicles').select('*').order('make_and_model');
  if (error) throw error;
  return (data || []).map(vehicleFromRow);
}

// Returns the instructor's first vehicle, auto-creating a sensible UK default
// (Vauxhall Corsa, manual, RHD) if the school has none. Cached for the session
// so we don't keep hitting the DB.
let _defaultVehicleCache: Vehicle | null = null;
export async function ensureDefaultVehicle(): Promise<Vehicle> {
  if (_defaultVehicleCache) return _defaultVehicleCache;
  const { schoolId } = await ownContext();

  const { data: existing } = await supabase
    .from('vehicles')
    .select('*')
    .eq('school_id', schoolId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    _defaultVehicleCache = vehicleFromRow(existing);
    return _defaultVehicleCache;
  }

  const plate = 'AD' + Math.floor(10 + Math.random() * 89) + ' ADI';
  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      school_id: schoolId,
      make_and_model: 'Vauxhall Corsa',
      registration_plate: plate,
      transmission: 'Manual',
      is_right_hand_drive: true,
    })
    .select('*')
    .single();
  if (error) throw error;
  _defaultVehicleCache = vehicleFromRow(data);
  return _defaultVehicleCache;
}

// =============================================================================
// LESSONS
// =============================================================================

export type LessonStatus = 'Scheduled' | 'Completed' | 'Cancelled';

export type Lesson = {
  id: string;
  student_id: string;
  instructor_id: string;
  vehicle_id: string;
  date: string;          // YYYY-MM-DD
  start_time: string;    // HH:mm
  end_time: string;      // HH:mm
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
  status: LessonStatus;
  pre_check_completed_at?: string;
};

// Helpers for HH:mm <-> timestamptz
const pad2 = (n: number) => String(n).padStart(2, '0');

function tsToParts(ts: string) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}

function combineToISO(date: string, time: string): string {
  // date "YYYY-MM-DD", time "HH:mm" → local ISO timestamp
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0, 0).toISOString();
}

const lessonFromRow = (r: any): Lesson => {
  const start = tsToParts(r.start_time);
  const end = r.end_time ? tsToParts(r.end_time) : { date: start.date, time: start.time };
  return {
    id: r.id,
    student_id: r.student_id,
    instructor_id: r.instructor_id,
    vehicle_id: r.vehicle_id,
    date: start.date,
    start_time: start.time,
    end_time: end.time,
    duration_hours: Number(r.duration_hours ?? 1),
    travel_minutes: r.travel_minutes ?? undefined,
    pickup_address: r.pickup_address ?? undefined,
    topic: r.topic ?? '',
    notes: r.notes ?? undefined,
    driving_faults: Number(r.driving_faults ?? 0),
    serious_faults: Number(r.serious_faults ?? 0),
    dangerous_faults: Number(r.dangerous_faults ?? 0),
    grade: r.grade ?? undefined,
    amount_paid: r.amount_paid != null ? Number(r.amount_paid) : undefined,
    status: (r.status ?? 'Scheduled') as LessonStatus,
    pre_check_completed_at: r.pre_check_completed_at ?? undefined,
  };
};

export async function listLessons(): Promise<Lesson[]> {
  const { data, error } = await supabase
    .from('lessons')
    .select('*')
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data || []).map(lessonFromRow);
}

export async function listLessonsForStudent(studentId: string): Promise<Lesson[]> {
  const { data, error } = await supabase
    .from('lessons')
    .select('*')
    .eq('student_id', studentId)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data || []).map(lessonFromRow);
}

export async function listLessonsBetween(fromISO: string, toISO: string): Promise<Lesson[]> {
  const { data, error } = await supabase
    .from('lessons')
    .select('*')
    .gte('start_time', fromISO)
    .lt('start_time', toISO)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data || []).map(lessonFromRow);
}

export type AddLessonInput = {
  student_id: string;
  date: string;        // YYYY-MM-DD
  start_time: string;  // HH:mm
  end_time: string;    // HH:mm
  topic: string;
  pickup_address?: string;
  travel_minutes?: number;
  notes?: string;
  amount_paid?: number;
  vehicle_id?: string; // optional override; otherwise default vehicle is used
};

export async function addLesson(input: AddLessonInput): Promise<Lesson> {
  const { instructorId } = await ownContext();
  const vehicle = input.vehicle_id ? null : await ensureDefaultVehicle();
  const vehicleId = input.vehicle_id || vehicle!.id;

  const startISO = combineToISO(input.date, input.start_time);
  const endISO = combineToISO(input.date, input.end_time);
  const [sh, sm] = input.start_time.split(':').map(Number);
  const [eh, em] = input.end_time.split(':').map(Number);
  const duration = Math.max(0.25, (eh + em / 60) - (sh + sm / 60));

  const payload = {
    student_id: input.student_id,
    instructor_id: instructorId,
    vehicle_id: vehicleId,
    start_time: startISO,
    end_time: endISO,
    duration_hours: duration,
    travel_minutes: input.travel_minutes ?? null,
    topic: input.topic,
    pickup_address: input.pickup_address || null,
    notes: input.notes || null,
    amount_paid: input.amount_paid ?? null,
    status: 'Scheduled' as LessonStatus,
  };
  const { data, error } = await supabase.from('lessons').insert(payload).select('*').single();
  if (error) throw error;
  return lessonFromRow(data);
}

export type UpdateLessonInput = Partial<{
  date: string;
  start_time: string;
  end_time: string;
  topic: string;
  pickup_address: string;
  travel_minutes: number;
  notes: string;
  driving_faults: number;
  serious_faults: number;
  dangerous_faults: number;
  grade: number;
  amount_paid: number;
  status: LessonStatus;
  pre_check_completed_at: string;
}>;

export async function updateLesson(id: string, patch: UpdateLessonInput): Promise<Lesson | undefined> {
  const dbPatch: Record<string, any> = {};
  if (patch.topic !== undefined) dbPatch.topic = patch.topic;
  if (patch.pickup_address !== undefined) dbPatch.pickup_address = patch.pickup_address || null;
  if (patch.travel_minutes !== undefined) dbPatch.travel_minutes = patch.travel_minutes;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (patch.driving_faults !== undefined) dbPatch.driving_faults = patch.driving_faults;
  if (patch.serious_faults !== undefined) dbPatch.serious_faults = patch.serious_faults;
  if (patch.dangerous_faults !== undefined) dbPatch.dangerous_faults = patch.dangerous_faults;
  if (patch.grade !== undefined) dbPatch.grade = patch.grade;
  if (patch.amount_paid !== undefined) dbPatch.amount_paid = patch.amount_paid;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.pre_check_completed_at !== undefined) dbPatch.pre_check_completed_at = patch.pre_check_completed_at;

  if (patch.date && patch.start_time) dbPatch.start_time = combineToISO(patch.date, patch.start_time);
  if (patch.date && patch.end_time)   dbPatch.end_time   = combineToISO(patch.date, patch.end_time);

  if (patch.date && patch.start_time && patch.end_time) {
    const [sh, sm] = patch.start_time.split(':').map(Number);
    const [eh, em] = patch.end_time.split(':').map(Number);
    dbPatch.duration_hours = Math.max(0.25, (eh + em / 60) - (sh + sm / 60));
  }

  const { data, error } = await supabase.from('lessons').update(dbPatch).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data ? lessonFromRow(data) : undefined;
}

export async function deleteLesson(id: string): Promise<boolean> {
  const { error } = await supabase.from('lessons').delete().eq('id', id);
  if (error) throw error;
  return true;
}
