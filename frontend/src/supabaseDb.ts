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
