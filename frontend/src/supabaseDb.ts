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

// ---------------------------------------------------------------------------
// Instructor profile / preferences
// ---------------------------------------------------------------------------
export type NavApp = 'google' | 'waze' | 'apple';

export type InstructorProfile = {
  id: string;
  school_id: string;
  auth_user_id: string | null;
  full_name: string;
  adi_number: string | null;
  preferred_nav_app: NavApp;
};

// Returns the currently signed-in instructor's profile row. Gracefully
// degrades if Migration 006 hasn't been applied yet (preferred_nav_app
// defaults to 'google').
export async function getInstructorProfile(): Promise<InstructorProfile | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) return null;
  // Try with preferred_nav_app first; fall back to a slimmer select if the
  // column doesn't exist yet (pre-Migration-006).
  let { data, error } = await supabase
    .from('instructors')
    .select('id, school_id, auth_user_id, full_name, adi_number, preferred_nav_app')
    .eq('auth_user_id', uid)
    .maybeSingle();
  if (error && /preferred_nav_app/i.test(error.message || '')) {
    const fallback = await supabase
      .from('instructors')
      .select('id, school_id, auth_user_id, full_name, adi_number')
      .eq('auth_user_id', uid)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    data = fallback.data as any;
    error = null;
  }
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    school_id: data.school_id,
    auth_user_id: data.auth_user_id,
    full_name: data.full_name,
    adi_number: data.adi_number,
    preferred_nav_app: ((data as any).preferred_nav_app as NavApp) || 'google',
  };
}

export async function updateInstructorPreferredNavApp(app: NavApp): Promise<void> {
  const { instructorId } = await ownContext();
  const { error } = await supabase
    .from('instructors')
    .update({ preferred_nav_app: app })
    .eq('id', instructorId);
  if (error) {
    // Graceful degradation if column doesn't exist yet.
    if (/preferred_nav_app/i.test(error.message || '')) {
      throw new Error('Please apply Migration 006 first (preferred_nav_app column).');
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Waiting list — learners opt in to be pinged about freed slots.
// ---------------------------------------------------------------------------
export async function getWaitingListStatus(studentId: string): Promise<boolean> {
  if (!studentId) return false;
  const { data, error } = await supabase
    .from('waiting_list')
    .select('active')
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) {
    // Pre-Migration 007 — table doesn't exist yet. Treat as 'not opted in'.
    return false;
  }
  return !!data?.active;
}

export async function setWaitingListStatus(
  studentId: string,
  schoolId: string,
  active: boolean,
): Promise<void> {
  if (!studentId || !schoolId) throw new Error('Missing student or school id');
  const { error } = await supabase
    .from('waiting_list')
    .upsert(
      {
        student_id: studentId,
        school_id: schoolId,
        active,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'school_id,student_id' },
    );
  if (error) {
    if (/relation .*waiting_list.* does not exist/i.test(error.message || '')) {
      throw new Error('Please apply Migration 007 first (waiting_list table).');
    }
    throw error;
  }
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
  is_default: boolean;
};

const vehicleFromRow = (r: any): Vehicle => ({
  id: r.id,
  school_id: r.school_id,
  make_and_model: r.make_and_model,
  registration_plate: r.registration_plate,
  transmission: r.transmission,
  is_right_hand_drive: r.is_right_hand_drive,
  is_default: Boolean(r.is_default),
});

export async function listVehicles(): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .order('is_default', { ascending: false })
    .order('make_and_model');
  if (error) throw error;
  return (data || []).map(vehicleFromRow);
}

// ---------------------------------------------------------------------------
// Vehicle CRUD — used by /vehicles-screen.tsx
// ---------------------------------------------------------------------------
export type VehicleInput = {
  make_and_model: string;
  registration_plate: string;
  transmission: 'Manual' | 'Automatic' | 'Electric';
  is_default?: boolean;
};

export async function createVehicle(input: VehicleInput): Promise<Vehicle> {
  const { schoolId } = await ownContext();
  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      school_id: schoolId,
      make_and_model: input.make_and_model.trim(),
      registration_plate: input.registration_plate.toUpperCase().trim(),
      transmission: input.transmission,
      is_right_hand_drive: true, // UK only
    })
    .select('*')
    .single();
  if (error) throw error;
  _defaultVehicleCache = null;
  const veh = vehicleFromRow(data);
  if (input.is_default) {
    await setDefaultVehicle(veh.id);
    return { ...veh, is_default: true };
  }
  return veh;
}

export async function updateVehicle(id: string, patch: Partial<VehicleInput>): Promise<Vehicle> {
  const dbPatch: Record<string, any> = {};
  if (patch.make_and_model !== undefined)     dbPatch.make_and_model     = patch.make_and_model.trim();
  if (patch.registration_plate !== undefined) dbPatch.registration_plate = patch.registration_plate.toUpperCase().trim();
  if (patch.transmission !== undefined)       dbPatch.transmission       = patch.transmission;
  const { data, error } = await supabase.from('vehicles').update(dbPatch).eq('id', id).select('*').single();
  if (error) throw error;
  _defaultVehicleCache = null;
  if (patch.is_default === true) {
    await setDefaultVehicle(id);
    return { ...vehicleFromRow(data), is_default: true };
  }
  return vehicleFromRow(data);
}

export async function deleteVehicle(id: string): Promise<boolean> {
  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (error) throw error;
  _defaultVehicleCache = null;
  return true;
}

// Calls the set_default_vehicle RPC (Migration 005). Falls back to a
// client-side two-step update if the RPC isn't deployed yet.
export async function setDefaultVehicle(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_vehicle', { p_vehicle_id: id });
  if (!error) {
    _defaultVehicleCache = null;
    return;
  }
  // Fallback for pre-Migration-005 environments.
  if (/function .* does not exist/i.test(error.message || '') || /column.*is_default/i.test(error.message || '')) {
    return;
  }
  // Other failure modes — propagate.
  throw error;
}

// Returns the instructor's first vehicle, auto-creating a sensible UK default
// (Vauxhall Corsa, manual, RHD) if the school has none. Cached for the session
// so we don't keep hitting the DB.
let _defaultVehicleCache: Vehicle | null = null;
export async function ensureDefaultVehicle(): Promise<Vehicle> {
  if (_defaultVehicleCache) return _defaultVehicleCache;
  const { schoolId } = await ownContext();

  // Prefer the row flagged as default (post Migration 005).
  const { data: pickDefault } = await supabase
    .from('vehicles')
    .select('*')
    .eq('school_id', schoolId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();
  if (pickDefault) {
    _defaultVehicleCache = vehicleFromRow(pickDefault);
    return _defaultVehicleCache;
  }

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

// =============================================================================
// COMPETENCIES (DVSA syllabus tracking)
// =============================================================================

export type Competency = {
  id: string;
  student_id: string;
  category_key: string;
  category_name: string;
  manoeuvre: string;     // same as category_name in our model
  level: number;         // 1-5 (competency_level column)
  progress: number;      // 0-100
  notes?: string;
  assessed_at?: string;
  // ---- Back-compat aliases (legacy mockDb shape used across screens) -------
  key: string;           // alias of category_key
  name: string;          // alias of category_name
  icon: string;          // lucide icon name
  skills: { name: string; level: number; progress: number }[];
};

// 28-strong UK DVSA syllabus categories (matches the mockDb seed list).
// `icon` matches a lucide-react-native icon name used in the UI grid.
export const DVSA_SYLLABUS: { key: string; name: string; icon: string }[] = [
  { key: 'eyesight',            name: 'Eyesight test',                   icon: 'eye' },
  { key: 'show_me_tell_me',     name: 'Show me, tell me',                icon: 'help-circle' },
  { key: 'controls',            name: 'Controls',                        icon: 'settings' },
  { key: 'moving_off',          name: 'Moving off & stopping',           icon: 'play' },
  { key: 'mirrors',             name: 'Mirrors, signals, manoeuvres',    icon: 'eye' },
  { key: 'positioning',         name: 'Positioning on the road',         icon: 'map-pin' },
  { key: 'junctions',           name: 'Junctions',                       icon: 'git-branch' },
  { key: 'roundabouts',         name: 'Roundabouts',                     icon: 'rotate-cw' },
  { key: 'crossroads',          name: 'Crossroads',                      icon: 'plus' },
  { key: 'traffic_lights',      name: 'Traffic lights',                  icon: 'traffic-cone' },
  { key: 'pedestrian_crossing', name: 'Pedestrian crossings',            icon: 'users' },
  { key: 'dual_carriageways',   name: 'Dual carriageways',               icon: 'minus' },
  { key: 'motorways',           name: 'Motorways',                       icon: 'fast-forward' },
  { key: 'meeting_traffic',     name: 'Meeting traffic',                 icon: 'car' },
  { key: 'overtaking',          name: 'Overtaking',                      icon: 'chevrons-right' },
  { key: 'crossing_traffic',    name: 'Crossing traffic',                icon: 'shuffle' },
  { key: 'parallel_park',       name: 'Parallel park',                   icon: 'parking-square' },
  { key: 'bay_park_forward',    name: 'Bay parking (forward)',           icon: 'square' },
  { key: 'bay_park_reverse',    name: 'Bay parking (reverse)',           icon: 'square' },
  { key: 'pull_up_right',       name: 'Pull up on the right',            icon: 'arrow-right' },
  { key: 'emergency_stop',      name: 'Emergency stop',                  icon: 'octagon' },
  { key: 'independent_driving', name: 'Independent driving',             icon: 'compass' },
  { key: 'sat_nav',             name: 'Sat-nav following',               icon: 'navigation' },
  { key: 'awareness',           name: 'Awareness & planning',            icon: 'compass' },
  { key: 'speed',               name: 'Speed appropriate to conditions', icon: 'gauge' },
  { key: 'progress',            name: 'Making progress',                 icon: 'trending-up' },
  { key: 'use_of_signals',      name: 'Use of signals',                  icon: 'radio' },
  { key: 'response_to_signs',   name: 'Response to road signs',          icon: 'alert-triangle' },
];

// Map of category_key -> icon (resolved without re-iterating the array).
const ICON_BY_KEY: Record<string, string> = DVSA_SYLLABUS.reduce((acc, c) => {
  acc[c.key] = c.icon;
  return acc;
}, {} as Record<string, string>);

// Synthesise the 3 sub-skills the legacy detail screen expects (Theory /
// Practical / Independent). Derived purely from the row's level + progress so
// the UI keeps rendering whilst we don't have a per-skill table yet.
function deriveSkills(name: string, level: number, progress: number) {
  return [
    { name: `${name} - Theory`,       level,                          progress },
    { name: `${name} - Practical`,    level: Math.max(1, level - 1),  progress: Math.max(0, progress - 15) },
    { name: `${name} - Independent`,  level: Math.max(1, level - 2),  progress: Math.max(0, progress - 30) },
  ];
}

const competencyFromRow = (r: any): Competency => {
  const category_key  = r.category_key || r.manoeuvre || 'controls';
  const category_name = r.category_name || r.manoeuvre || category_key;
  const level    = Number(r.competency_level ?? 1);
  const progress = Number(r.progress ?? 0);
  return {
    id: r.id,
    student_id: r.student_id,
    category_key,
    category_name,
    manoeuvre: r.manoeuvre || category_name,
    level,
    progress,
    notes: r.notes ?? undefined,
    assessed_at: r.assessed_at ?? undefined,
    // Back-compat aliases
    key:  category_key,
    name: category_name,
    icon: ICON_BY_KEY[category_key] || 'circle',
    skills: deriveSkills(category_name, level, progress),
  };
};

export async function listCompetencies(studentId: string): Promise<Competency[]> {
  const { data, error } = await supabase
    .from('dvsa_syllabus_tracking')
    .select('*')
    .eq('student_id', studentId)
    .order('category_key', { ascending: true });
  if (error) throw error;
  return (data || []).map(competencyFromRow);
}

export async function seedCompetenciesIfEmpty(studentId: string): Promise<number> {
  const existing = await listCompetencies(studentId);
  if (existing.length > 0) return 0;
  const rows = DVSA_SYLLABUS.map((c) => ({
    student_id: studentId,
    manoeuvre: c.name,
    category_key: c.key,
    category_name: c.name,
    competency_level: 1,
    progress: 0,
  }));
  const { error } = await supabase.from('dvsa_syllabus_tracking').insert(rows);
  if (error) throw error;
  return rows.length;
}

export async function upsertCompetency(
  studentId: string,
  category_key: string,
  patch: { level?: number; progress?: number; notes?: string },
): Promise<Competency> {
  // First find existing row
  const { data: existing } = await supabase
    .from('dvsa_syllabus_tracking')
    .select('*')
    .eq('student_id', studentId)
    .eq('category_key', category_key)
    .maybeSingle();

  const payload: Record<string, any> = { assessed_at: new Date().toISOString() };
  if (patch.level !== undefined) payload.competency_level = patch.level;
  if (patch.progress !== undefined) payload.progress = patch.progress;
  if (patch.notes !== undefined) payload.notes = patch.notes;

  if (existing) {
    const { data, error } = await supabase
      .from('dvsa_syllabus_tracking')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return competencyFromRow(data);
  }

  // Create new
  const spec = DVSA_SYLLABUS.find((c) => c.key === category_key);
  const { data, error } = await supabase
    .from('dvsa_syllabus_tracking')
    .insert({
      student_id: studentId,
      category_key,
      category_name: spec?.name || category_key,
      manoeuvre: spec?.name || category_key,
      competency_level: patch.level ?? 1,
      progress: patch.progress ?? 0,
      notes: patch.notes,
    })
    .select('*')
    .single();
  if (error) throw error;
  return competencyFromRow(data);
}

// =============================================================================
// REFLECTIVE LOGS
// =============================================================================

export type ReflectiveLog = {
  id: string;
  student_id: string;
  lesson_id?: string;
  what_well?: string;
  what_difficult?: string;
  next_focus?: string;
  created_at: string;
};

const reflectiveFromRow = (r: any): ReflectiveLog => ({
  id: r.id,
  student_id: r.student_id,
  lesson_id: r.lesson_id ?? undefined,
  what_well: r.what_well ?? undefined,
  what_difficult: r.what_difficult ?? undefined,
  next_focus: r.next_focus ?? undefined,
  created_at: r.created_at,
});

export async function listReflectiveLogs(studentId: string): Promise<ReflectiveLog[]> {
  const { data, error } = await supabase
    .from('reflective_logs')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(reflectiveFromRow);
}

export async function addReflectiveLog(input: {
  student_id: string;
  lesson_id?: string;
  what_well?: string;
  what_difficult?: string;
  next_focus?: string;
}): Promise<ReflectiveLog> {
  const { data, error } = await supabase
    .from('reflective_logs')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return reflectiveFromRow(data);
}

// =============================================================================
// BADGES
// =============================================================================

export type Badge = {
  id: string;
  student_id: string;
  badge_key: string;
  badge_name: string;
  description?: string;
  earned_at: string;
};

export async function listBadges(studentId: string): Promise<Badge[]> {
  const { data, error } = await supabase
    .from('badges_earned')
    .select('*')
    .eq('student_id', studentId)
    .order('earned_at', { ascending: false });
  if (error) throw error;
  return (data || []) as Badge[];
}

export async function awardBadge(input: { student_id: string; badge_key: string; badge_name: string; description?: string }): Promise<Badge> {
  const { data, error } = await supabase
    .from('badges_earned')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as Badge;
}

// Idempotent — silently returns the existing row if the student already holds
// this badge (relies on the unique constraint badges_one_per_student).
// Returns null on a soft failure so the caller can keep going.
export async function awardBadgeIfMissing(input: {
  student_id: string;
  badge_key: string;
  badge_name: string;
  description?: string;
}): Promise<Badge | null> {
  try {
    // Fast path: do we already hold it?
    const { data: existing } = await supabase
      .from('badges_earned')
      .select('*')
      .eq('student_id', input.student_id)
      .eq('badge_key', input.badge_key)
      .maybeSingle();
    if (existing) return existing as Badge;

    const { data, error } = await supabase
      .from('badges_earned')
      .insert(input)
      .select('*')
      .maybeSingle();
    if (error) {
      // Duplicate-key race is fine — somebody else awarded it first.
      if (/duplicate key|unique/i.test(error.message || '')) return null;
      // eslint-disable-next-line no-console
      console.warn('[awardBadgeIfMissing] failed:', error.message);
      return null;
    }
    return data as Badge;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[awardBadgeIfMissing] error:', e);
    return null;
  }
}

// Determines whether a competency change should mint a "Mastered <category>"
// badge. Triggered from useSupabaseData.updateCompetency.
export async function maybeAwardCompetencyBadge(
  studentId: string,
  competency: Competency,
): Promise<Badge | null> {
  if (!studentId || !competency) return null;
  if (competency.level < 4) return null;
  const badge_key = `competency_${competency.key}_l4`;
  const badge_name = `Confident: ${competency.name}`;
  const description =
    competency.level >= 5
      ? `Reached Level ${competency.level}/5 on ${competency.name}.`
      : `Reached Level 4/5 on ${competency.name}.`;
  return awardBadgeIfMissing({ student_id: studentId, badge_key, badge_name, description });
}

// =============================================================================
// BLOCK BOOKINGS (Wallet)
// =============================================================================

export type BlockBooking = {
  id: string;
  student_id: string;
  hours_paid: number;
  hours_used: number;
  amount: number;
  purchased_at: string;
  notes?: string;
};

export async function listBlockBookings(studentId: string): Promise<BlockBooking[]> {
  const { data, error } = await supabase
    .from('block_bookings')
    .select('*')
    .eq('student_id', studentId)
    .order('purchased_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    student_id: r.student_id,
    hours_paid: Number(r.hours_paid),
    hours_used: Number(r.hours_used),
    amount: Number(r.amount),
    purchased_at: r.purchased_at,
    notes: r.notes ?? undefined,
  }));
}

export async function addBlockBooking(input: { student_id: string; hours_paid: number; amount: number; notes?: string }): Promise<BlockBooking> {
  const { data, error } = await supabase
    .from('block_bookings')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    student_id: data.student_id,
    hours_paid: Number(data.hours_paid),
    hours_used: Number(data.hours_used),
    amount: Number(data.amount),
    purchased_at: data.purchased_at,
    notes: data.notes ?? undefined,
  };
}

// =============================================================================
// Find a student row by email (used by AuthContext for newly-invited students)
// =============================================================================

export async function getStudentByEmail(email: string): Promise<Student | undefined> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : undefined;
}

// Resolve the current learner via Supabase Auth uid (Migration 004 adds the
// auth_user_id column). Falls back gracefully if the column doesn't exist yet.
export async function getStudentByAuthId(authUserId: string): Promise<Student | undefined> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) {
    // Most likely "column auth_user_id does not exist" before Migration 004 ran.
    // Treat as "not linked yet" rather than failing hard.
    if (/column.*auth_user_id/i.test(error.message || '')) return undefined;
    throw error;
  }
  return data ? fromRow(data) : undefined;
}
