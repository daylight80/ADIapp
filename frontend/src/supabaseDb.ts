// Supabase data layer — Wave 3 slice 1: Students.
// This file gradually replaces /app/frontend/src/mockDb.ts. Each function below
// returns Promises and operates against the live `students` / `driving_schools`
// / `instructors` tables. RLS does the multi-tenant scoping automatically.

import type { AgreementContext } from './agreementTerms';
import { supabase } from './supabaseClient';
import { cleanVehicleColour, type InstructorCardData } from './instructorCard';
import type { PaymentRow, PaymentMethod } from './payments';
import type { SlotAlertStatus } from './slotAlertStatus';
import type { DeadlineItem, EditableDeadlineKind } from './deadlines';
import { pickFocus } from './lessonFocus';

// ---------------------------------------------------------------------------
// Types — kept compatible with mockDb so we can swap screens incrementally
// ---------------------------------------------------------------------------

export type StudentStatus = 'New' | 'Active' | 'Test Ready' | 'Passed' | 'Inactive' | 'Waitlist';

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
  notes?: string | null;
  notes_updated_at?: string | null;
  notes_updated_by?: string | null;
  notes_updated_by_name?: string | null;
  // Added 23 Sept 2026, per Grant directly — Phase 1 of the "not using
  // the app" research (MyDriveTime's Select Students broadcast screen):
  // a student row with no linked auth account at all can't receive any
  // push notification or use the student portal, full stop. Already
  // fetched by listStudents()'s own select('*') below — just never
  // carried through into the mapped object until now.
  auth_user_id?: string | null;
  // Phase 2 (23 Sept 2026, same request) — for a student who DOES have
  // an account but has gone quiet. Stamped by the student app itself on
  // every launch; null means either no account yet (see auth_user_id
  // above) or an account that's never actually been opened since this
  // column started being written.
  last_active_at?: string | null;
  // Pupil Agreement, signed by the student (Migration 051).
  tc_signed_at?: string | null;
  tc_signature_name?: string | null;
  /** Whether the pupil wants a push notification when their instructor has a free slot. */
  slot_alerts?: boolean;
  /** Waiting-list stage (Migration 086): 'Waiting' | 'Contacted' | 'Booked'; null unless status is Waitlist. */
  waitlist_stage?: string | null;
  waitlist_stage_at?: string | null;
  /** Parent or guardian contact, for pupils under 18 (all optional). */
  guardian_name?: string | null;
  guardian_phone?: string | null;
  guardian_email?: string | null;
  /** Pupil's optional OK to use their pass photo/video on social media and the school's website. */
  media_consent?: boolean;
  media_consent_at?: string | null;
};

// Shared across the Students screen and Phase 3's Select Students picker
// (23 Sept 2026), per Grant directly — extracted so the "how many days
// counts as gone quiet" threshold lives in exactly one place rather than
// two copies that could quietly drift apart. Returns null when there's
// nothing worth flagging (an account that's been active more recently
// than the threshold) — callers render nothing in that case, matching
// how sparse MyDriveTime's own warning is in the research this is based
// on, not a "last seen today" badge on every row.
export function studentAppUsageWarning(student: Pick<Student, 'auth_user_id' | 'last_active_at'>): string | null {
  if (!student.auth_user_id) return "Hasn't set up their account yet";
  if (!student.last_active_at) return "Hasn't opened the app yet";
  const days = Math.floor((Date.now() - new Date(student.last_active_at).getTime()) / 86400000);
  if (days < 7) return null;
  const label = days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`;
  return `Last seen ${label}`;
}

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
  notes: r.notes ?? null,
  notes_updated_at: r.notes_updated_at ?? null,
  notes_updated_by: r.notes_updated_by ?? null,
  notes_updated_by_name: r.notes_updated_by_name ?? null,
  auth_user_id: r.auth_user_id ?? null,
  last_active_at: r.last_active_at ?? null,
  waitlist_stage: r.waitlist_stage ?? null,
  waitlist_stage_at: r.waitlist_stage_at ?? null,
  tc_signed_at: r.tc_signed_at ?? null,
  tc_signature_name: r.tc_signature_name ?? null,
  slot_alerts: r.slot_alerts !== false,
  guardian_name: r.guardian_name ?? null,
  guardian_phone: r.guardian_phone ?? null,
  guardian_email: r.guardian_email ?? null,
  media_consent: r.media_consent === true,
  media_consent_at: r.media_consent_at ?? null,
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

// ===========================================================================
// ARREARS — net outstanding balance per student
// Backed by Migration 022 view `students_with_balance`.
//   outstanding_gbp > 0  → student owes money
//   outstanding_gbp ≤ 0  → up to date or in credit
// Returns a Map<student_id, outstanding_gbp> for cheap lookups when
// hydrating the Students CRM list and the dashboard tile.
// ===========================================================================
export type StudentBalance = {
  student_id: string;
  outstanding_gbp: number;
};

export async function listStudentBalances(): Promise<StudentBalance[]> {
  const { data, error } = await supabase
    .from('students_with_balance')
    .select('student_id,outstanding_gbp');
  if (error) {
    // Don't crash callers if Migration 022 isn't applied yet — just return [].
    // eslint-disable-next-line no-console
    console.warn('[arrears] listStudentBalances failed:', error.message);
    return [];
  }
  return (data || []).map((r: any) => ({
    student_id: r.student_id,
    outstanding_gbp: Number(r.outstanding_gbp ?? 0),
  }));
}

/**
 * Convenience summariser for the dashboard tile.
 * Returns { count, total_gbp } across all students with outstanding > £0.
 */
export async function getArrearsSummary(): Promise<{ count: number; total_gbp: number }> {
  const rows = await listStudentBalances();
  let count = 0;
  let total = 0;
  for (const r of rows) {
    if (r.outstanding_gbp > 0) {
      count += 1;
      total += r.outstanding_gbp;
    }
  }
  return { count, total_gbp: Math.round(total) };
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
export async function ownContext() {
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  const uid = user?.id;
  if (!uid) throw new Error('Not signed in');

  const { data: instructor, error } = await supabase
    .from('instructors')
    .select('id, school_id')
    .eq('auth_user_id', uid)
    .maybeSingle();
  if (error) throw error;
  if (instructor) return { schoolId: instructor.school_id as string, instructorId: instructor.id as string };

  // Not linked by auth_user_id yet — this is expected for a newly-invited
  // instructor's very first sign-in (25 Aug 2026): the owner's invite form
  // creates the instructors row ahead of time with auth_user_id left null,
  // the same pattern the existing student invite flow already relies on
  // (see getStudentByEmail). Fall back to matching by email, and self-heal
  // the link so every future call goes straight through the fast path
  // above instead of hitting this fallback every time.
  const email = user?.email;
  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from('instructors')
      .select('id, school_id')
      .eq('email', email.toLowerCase())
      .is('auth_user_id', null)
      .maybeSingle();
    if (!emailErr && byEmail) {
      await supabase.from('instructors').update({ auth_user_id: uid }).eq('id', byEmail.id);
      return { schoolId: byEmail.school_id as string, instructorId: byEmail.id as string };
    }
  }
  throw new Error('No instructor profile for current user');
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
  tc_signed_at: string | null;
  tc_signature_name: string | null;
  // Added 1 Sept 2026 for the dedicated, view-only instructor profile
  // screen — these columns have existed since the add-instructor
  // migration, just never surfaced through this function before.
  mobile_number: string | null;
  address: string | null;
  email: string | null;
  // Added 11 Sept 2026 for the self-editable "My Details" screen —
  // car_make/car_model/number_plate already existed (captured once at
  // invite time via inviteInstructor()), just never surfaced through
  // this function before; car_colour is the one genuinely new column.
  car_make: string | null;
  car_model: string | null;
  number_plate: string | null;
  car_colour: string | null;
  // Added 21 Sept 2026, per Grant directly — driving_schools already has
  // its own google_review_url (Migration 028), used by Franchise via
  // School Profile, but solo tiers have no menu path to that screen at
  // all. This is the same setting, stored directly on the instructor's
  // own row instead, so it lives in My Details.
  google_review_url: string | null;
};

// Returns the currently signed-in instructor's profile row. Gracefully
// degrades if Migration 006 or 023 haven't been applied yet
// (preferred_nav_app defaults to 'google'; tc fields default to null).
export async function getInstructorProfile(): Promise<InstructorProfile | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  const uid = user?.id;
  if (!uid) return null;
  // Try the full column set first; fall back a step at a time if older
  // migrations haven't been applied yet.
  let { data, error } = await supabase
    .from('instructors')
    .select('id, school_id, auth_user_id, full_name, adi_number, preferred_nav_app, tc_signed_at, tc_signature_name, mobile_number, address, email, car_make, car_model, number_plate, car_colour, google_review_url')
    .eq('auth_user_id', uid)
    .maybeSingle();
  if (error && /google_review_url/i.test(error.message || '')) {
    const fallback = await supabase
      .from('instructors')
      .select('id, school_id, auth_user_id, full_name, adi_number, preferred_nav_app, tc_signed_at, tc_signature_name, mobile_number, address, email, car_make, car_model, number_plate, car_colour')
      .eq('auth_user_id', uid)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    data = { ...fallback.data, google_review_url: null } as any;
    error = null;
  }
  if (error && /car_colour/i.test(error.message || '')) {
    const fallback = await supabase
      .from('instructors')
      .select('id, school_id, auth_user_id, full_name, adi_number, preferred_nav_app, tc_signed_at, tc_signature_name, mobile_number, address, email, car_make, car_model, number_plate')
      .eq('auth_user_id', uid)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    data = { ...fallback.data, car_colour: null } as any;
    error = null;
  }
  if (error && /mobile_number|address|email/i.test(error.message || '')) {
    const fallback = await supabase
      .from('instructors')
      .select('id, school_id, auth_user_id, full_name, adi_number, preferred_nav_app, tc_signed_at, tc_signature_name')
      .eq('auth_user_id', uid)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    data = fallback.data as any;
    error = null;
  }
  if (error && /tc_signed_at|tc_signature_name/i.test(error.message || '')) {
    const fallback = await supabase
      .from('instructors')
      .select('id, school_id, auth_user_id, full_name, adi_number, preferred_nav_app')
      .eq('auth_user_id', uid)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    data = fallback.data as any;
    error = null;
  }
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

  // Not linked by auth_user_id yet — the same gap already found and
  // fixed in ownContext() and loadProfile() (25/31 Aug 2026): a newly-
  // invited instructor's row has auth_user_id left null until their
  // first sign-in. Added here too for the same reason, even though in
  // practice ownContext()/loadProfile() will usually have already
  // self-healed the link by the time someone reaches a profile screen
  // post-login — better to be consistent than rely on that ordering.
  if (!data && user?.email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from('instructors')
      .select('id, school_id, auth_user_id, full_name, adi_number, preferred_nav_app, tc_signed_at, tc_signature_name, mobile_number, address, email, car_make, car_model, number_plate, car_colour, google_review_url')
      .eq('email', user.email.toLowerCase())
      .is('auth_user_id', null)
      .maybeSingle();
    if (!emailErr && byEmail) {
      await supabase.from('instructors').update({ auth_user_id: uid }).eq('id', byEmail.id);
      data = byEmail;
    }
  }

  if (!data) return null;
  return {
    id: data.id,
    school_id: data.school_id,
    auth_user_id: data.auth_user_id,
    full_name: data.full_name,
    adi_number: data.adi_number,
    preferred_nav_app: ((data as any).preferred_nav_app as NavApp) || 'google',
    tc_signed_at: (data as any).tc_signed_at ?? null,
    tc_signature_name: (data as any).tc_signature_name ?? null,
    mobile_number: (data as any).mobile_number ?? null,
    address: (data as any).address ?? null,
    email: (data as any).email ?? null,
    car_make: (data as any).car_make ?? null,
    car_model: (data as any).car_model ?? null,
    number_plate: (data as any).number_plate ?? null,
    car_colour: (data as any).car_colour ?? null,
    google_review_url: (data as any).google_review_url ?? null,
  };
}

// Self-service update for the signed-in instructor's own profile fields
// (11 Sept 2026), per Grant directly — scoped to solo tiers
// (Starter/Growth/Pro), where the instructor is always their own school
// owner, so the existing ins_owner_all RLS policy already covers this
// with no policy change needed. A non-owner Franchise instructor calling
// this would simply have the update rejected by that same RLS — this
// function doesn't check tier/ownership itself, since the database is
// the actual security boundary here, same convention as isOwner checks
// elsewhere in this app being UX-only gates, not the real enforcement.
export type MyInstructorProfileUpdate = {
  full_name?: string;
  adi_number?: string;
  mobile_number?: string | null;
  email?: string | null;
  address?: string | null;
  car_make?: string | null;
  car_model?: string | null;
  number_plate?: string | null;
  car_colour?: string | null;
  google_review_url?: string | null;
};

export async function updateMyInstructorProfile(input: MyInstructorProfileUpdate): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) throw new Error('Not signed in');
  const payload: Record<string, any> = {};
  if (input.full_name !== undefined) payload.full_name = input.full_name.trim();
  if (input.adi_number !== undefined) payload.adi_number = input.adi_number.trim();
  if (input.mobile_number !== undefined) payload.mobile_number = input.mobile_number?.trim() || null;
  if (input.email !== undefined) payload.email = input.email?.trim() || null;
  if (input.address !== undefined) payload.address = input.address?.trim() || null;
  if (input.car_make !== undefined) payload.car_make = input.car_make?.trim() || null;
  if (input.car_model !== undefined) payload.car_model = input.car_model?.trim() || null;
  if (input.number_plate !== undefined) payload.number_plate = input.number_plate?.trim().toUpperCase() || null;
  if (input.car_colour !== undefined) payload.car_colour = input.car_colour?.trim() || null;
  if (input.google_review_url !== undefined) payload.google_review_url = input.google_review_url?.trim() || null;
  const { error } = await supabase.from('instructors').update(payload).eq('auth_user_id', uid);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Invite a new instructor (25 Aug 2026) — owner-only. RLS already enforces
// this at the database level (the ins_owner_all policy restricts ALL
// commands on this table to is_school_owner(school_id)), so a non-owner
// instructor calling this gets a real RLS rejection, not just a hidden UI
// button — the UI-side owner check (see owner-dashboard-screen.tsx) is
// for a good experience, not the actual security boundary.
// ---------------------------------------------------------------------------

export type InviteInstructorInput = {
  full_name: string;
  adi_number: string;
  mobile_number: string;
  email: string;
  address: string;
  car_make: string;
  car_model: string;
  number_plate: string;
};

export type InvitedInstructor = {
  id: string;
  school_id: string;
  full_name: string;
  adi_number: string;
  email: string;
  mobile_number: string | null;
  address: string | null;
  car_make: string | null;
  car_model: string | null;
  number_plate: string | null;
};

/**
 * Creates the new instructor's row ahead of time, with auth_user_id left
 * null. Their own auth account gets linked to this row automatically on
 * first sign-in via ownContext()'s email-fallback (see above) — the same
 * "create the row first, link it on first login" pattern the existing
 * student invite flow already relies on, not something new invented here.
 */
export async function inviteInstructor(input: InviteInstructorInput): Promise<InvitedInstructor> {
  const { schoolId } = await ownContext();
  const payload = {
    school_id: schoolId,
    auth_user_id: null,
    full_name: input.full_name.trim(),
    adi_number: input.adi_number.trim(),
    email: input.email.trim().toLowerCase(),
    mobile_number: input.mobile_number?.trim() || null,
    address: input.address?.trim() || null,
    car_make: input.car_make?.trim() || null,
    car_model: input.car_model?.trim() || null,
    number_plate: input.number_plate?.trim().toUpperCase() || null,
  };
  const { data, error } = await supabase.from('instructors').insert(payload).select('*').single();
  if (error) throw error;
  return data as InvitedInstructor;
}

/**
 * Builds the invite link client-side — same base64 payload + fallback-link
 * pattern the student invite flow already uses (see student-crm-screen.tsx's
 * submitAddStudent), deliberately NOT calling a backend email-send endpoint
 * yet. /v2/students/invite is hardcoded to role=student and can't be reused
 * as-is; sending a real email for instructors is a separate follow-up piece,
 * not bundled into this function.
 */
export function buildInstructorInviteLink(instructor: InvitedInstructor, appOrigin: string): string {
  const payload = btoa(JSON.stringify({
    type: 'instructor',
    email: instructor.email,
    name: instructor.full_name,
    instructor_id: instructor.id,
    school_id: instructor.school_id,
  }));
  return `${appOrigin}/?invite=${payload}`;
}

// Records the signed-in student's Pupil Agreement signature. This is a
// compliance/consent record, so it is written by the database (a SECURITY
// DEFINER function that only touches the caller's own row, once) and the
// timestamp comes from the server, not the phone's clock.
export async function signPupilAgreementAsStudent(signatureName: string, agreementText?: string): Promise<{ tc_signed_at: string; tc_signature_name: string }> {
  const trimmed = signatureName.trim();
  if (trimmed.length < 3) {
    throw new Error('Signature must be at least 3 characters.');
  }
  const { data, error } = await supabase.rpc('sign_pupil_agreement_as_student', { p_signature: trimmed, p_agreement_text: agreementText ?? null });
  if (error) {
    if (/sign_pupil_agreement_as_student/i.test(error.message || '') && /could not find|does not exist/i.test(error.message || '')) {
      throw new Error('Please apply Migration 051 first (student Pupil Agreement).');
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.tc_signed_at) throw new Error('Could not record your signature. Please try again.');
  return { tc_signed_at: row.tc_signed_at, tc_signature_name: row.tc_signature_name };
}

// Optional consent for the pupil's pass photo/video to be used on social media and the school's
// website. Separate from the agreement signature; can be changed or withdrawn at any time.
export async function getMyMediaConsent(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_my_media_consent');
  if (error) throw error;
  return data === true;
}

export async function setMyMediaConsent(consent: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_my_media_consent', { p_consent: consent });
  if (error) throw error;
  return data === true;
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

export type WaitingListEntry = {
  student_id: string;
  full_name: string;
  created_at: string;
};

// Added 22 Sept 2026, per Grant directly — the fairness-ordered gap
// broadcast needs to show the instructor who's actually longest-waiting
// (and how long) before they choose who to offer a freed slot to, not
// just fire a blind broadcast. RLS already scopes waiting_list to the
// caller's own school, same as getWaitingListStatus/setWaitingListStatus
// above, so no explicit school_id filter is needed here either.
export async function listWaitingList(): Promise<WaitingListEntry[]> {
  const { data, error } = await supabase
    .from('waiting_list')
    .select('student_id, created_at, students(full_name)')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) {
    if (/relation .*waiting_list.* does not exist/i.test(error.message || '')) {
      return [];
    }
    throw error;
  }
  return (data || [])
    .filter((row: any) => row.students?.full_name)
    .map((row: any) => ({ student_id: row.student_id, full_name: row.students.full_name, created_at: row.created_at }));
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
  // A new pupil starts on the instructor's default rate from Pricing & packages (not a fixed figure).
  // If that can't be read, the database's own default applies.
  let startingRate = input.hourly_rate;
  if (startingRate == null) {
    try { startingRate = await getInstructorHourlyRate(); } catch { startingRate = undefined; }
  }
  const payload = {
    school_id: schoolId,
    instructor_id: instructorId,
    full_name: input.name.trim(),
    email: input.email.trim() || null,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    postcode: input.postcode?.trim().toUpperCase() || null,
    provisional_licence: (input.provisional_licence || '').trim() || 'PENDING',
    ...(startingRate != null ? { hourly_rate: startingRate } : {}),
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
  notes: string | null;
  provisional_licence: string;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  waitlist_stage: 'Waiting' | 'Contacted' | 'Booked';
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
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (patch.provisional_licence !== undefined) dbPatch.provisional_licence = patch.provisional_licence.toUpperCase().replace(/\s+/g, '');
  if (patch.waitlist_stage !== undefined) dbPatch.waitlist_stage = patch.waitlist_stage;
  if (patch.guardian_name !== undefined) dbPatch.guardian_name = patch.guardian_name?.trim() || null;
  if (patch.guardian_phone !== undefined) dbPatch.guardian_phone = patch.guardian_phone?.trim() || null;
  if (patch.guardian_email !== undefined) dbPatch.guardian_email = patch.guardian_email?.trim().toLowerCase() || null;

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
// Demo seeding — DISABLED for production.
//
// Previously this seeded a small set of demo students (Sophie Carter,
// Oliver Bennett, Jamie Williams, Amelia Hughes with @example.co.uk emails)
// into a freshly-logged-in instructor's account. That created repeated
// duplicates across schools and polluted the database, so it has been turned
// off. To re-enable for dev/demo, restore the array and remove the early
// return in `seedDemoStudentsIfEmpty()`.
// ---------------------------------------------------------------------------

const DEMO_STUDENTS: Omit<AddStudentInput, 'provisional_licence'>[] = [
  { name: 'Sophie Carter',   email: 'sophie.carter@example.co.uk',   phone: '07700 900111', address: '12 Abbey Road',     postcode: 'NW8 9AY',  hourly_rate: 38, test_date: new Date(Date.now() + 14 * 86400_000).toISOString() },
  { name: 'Oliver Bennett',  email: 'oliver.bennett@example.co.uk',  phone: '07700 900222', address: '42 Pickwick Avenue', postcode: 'NW1 2AB',  hourly_rate: 36 },
  { name: 'Jamie Williams',  email: 'jamie.w@example.co.uk',         phone: '07700 900333', address: '7 Camden High St',   postcode: 'NW1 0LU',  hourly_rate: 36 },
  { name: 'Amelia Hughes',   email: 'amelia.hughes@example.co.uk',   phone: '07700 900444', address: '88 King\u2019s Cross',     postcode: 'N1 9AL',   hourly_rate: 38 },
];

export async function seedDemoStudentsIfEmpty(): Promise<{ created: number }> {
  // Auto-seeding is disabled in production to keep the database clean.
  // Instructors add their own real students via the "Add student" FAB.
  void DEMO_STUDENTS; // keep reference to avoid TS unused warning
  return { created: 0 };
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
  /** Optional, e.g. "Silver"; shown to pupils so they can spot the car. */
  colour?: string | null;
};

const vehicleFromRow = (r: any): Vehicle => ({
  id: r.id,
  school_id: r.school_id,
  make_and_model: r.make_and_model,
  colour: r.colour ?? null,
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
  colour?: string | null;
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
      colour: cleanVehicleColour(input.colour),
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
  if (patch.colour !== undefined)             dbPatch.colour             = cleanVehicleColour(patch.colour);
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
  /** Practical Test entries: the driving test centre. */
  test_centre?: string;
  /** Practical Test entries: when the test itself starts (HH:mm), inside the lesson block. */
  test_time?: string;
  topic: string;
  lesson_type: string;
  notes?: string;
  driving_faults: number;
  serious_faults: number;
  dangerous_faults: number;
  grade?: number;
  amount_paid?: number;
  quoted_amount?: number;
  status: LessonStatus;
  pre_check_completed_at?: string;
  cancellation_charge?: number;
  cancellation_note?: string;
  series_id?: string;
  /** Pre-lesson plan (Migration 090): syllabus topic keys, the ones ticked off, and a short briefing. */
  plan_topics?: string[];
  plan_covered?: string[];
  plan_brief?: string;
  /** How confident the pupil said they felt afterwards, 1 to 5 (Migration 092). Set by the pupil only. */
  pupil_confidence?: number;
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
    test_centre: r.test_centre ?? undefined,
    test_time: r.test_start ? tsToParts(r.test_start).time : undefined,
    topic: r.topic ?? '',
    lesson_type: r.lesson_type ?? 'Standard',
    notes: r.notes ?? undefined,
    driving_faults: Number(r.driving_faults ?? 0),
    serious_faults: Number(r.serious_faults ?? 0),
    dangerous_faults: Number(r.dangerous_faults ?? 0),
    grade: r.grade ?? undefined,
    amount_paid: r.amount_paid != null ? Number(r.amount_paid) : undefined,
    quoted_amount: r.quoted_amount != null ? Number(r.quoted_amount) : undefined,
    status: (r.status ?? 'Scheduled') as LessonStatus,
    pre_check_completed_at: r.pre_check_completed_at ?? undefined,
    cancellation_charge: r.cancellation_charge != null ? Number(r.cancellation_charge) : undefined,
    cancellation_note: r.cancellation_note ?? undefined,
    series_id: r.series_id ?? undefined,
    plan_topics: r.plan_topics ?? [],
    plan_covered: r.plan_covered ?? [],
    plan_brief: r.plan_brief ?? undefined,
    pupil_confidence: r.pupil_confidence ?? undefined,
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

/** One lesson by id, or null when it no longer exists (deleted elsewhere). */
export async function getLessonById(id: string): Promise<Lesson | null> {
  const { data, error } = await supabase.from('lessons').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? lessonFromRow(data) : null;
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
  // Explicit instructor_id filter (1 Sept 2026) — found while checking a
  // question about how Franchise multi-instructor schools actually work.
  // This previously relied entirely on RLS, which is fine for a regular
  // instructor (les_instructor_all already restricts them to their own
  // lessons) — but the school owner ALSO has a separate, broader policy
  // (les_owner_all, needed for the owner dashboard's "today across the
  // school" view) granting them every lesson at their school. RLS
  // policies are OR'd together, so with no explicit filter here, an
  // owner's own personal diary would have shown every instructor's
  // lessons mixed together, not just their own. Only used by the diary
  // screen (useLessonsForWeek/useLessonsForMonth, confirmed the only
  // callers), where "just my own teaching schedule" is always correct
  // regardless of owner status — the owner dashboard's own "everyone at
  // the school" view is a genuinely separate screen with its own queries.
  const { instructorId } = await ownContext();
  const { data, error } = await supabase
    .from('lessons')
    .select('*')
    .eq('instructor_id', instructorId)
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
  lesson_type?: string; // defaults to 'Standard' in the DB if omitted
  pickup_address?: string;
  test_centre?: string; // Practical Test entries only
  test_time?: string;   // HH:mm, Practical Test entries only
  travel_minutes?: number;
  notes?: string;
  amount_paid?: number;
  quoted_amount?: number;
  vehicle_id?: string; // optional override; otherwise default vehicle is used
  series_id?: string;  // shared uuid stamped on every occurrence of a recurring series
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

  const payload: Record<string, any> = {
    student_id: input.student_id,
    instructor_id: instructorId,
    vehicle_id: vehicleId,
    start_time: startISO,
    end_time: endISO,
    duration_hours: duration,
    travel_minutes: input.travel_minutes ?? null,
    topic: input.topic,
    lesson_type: input.lesson_type || 'Standard',
    pickup_address: input.pickup_address || null,
    test_centre: input.test_centre || null,
    test_start: input.test_time ? combineToISO(input.date, input.test_time) : null,
    notes: input.notes || null,
    amount_paid: input.amount_paid ?? null,
    quoted_amount: input.quoted_amount ?? null,
    status: 'Scheduled' as LessonStatus,
  };
  if (input.series_id) payload.series_id = input.series_id;
  const { data, error } = await supabase.from('lessons').insert(payload).select('*').single();
  if (error) {
    // Graceful fallback for instances where Migration 016 hasn't been applied
    // yet — retry the insert without series_id so the lesson still saves and
    // the instructor isn't blocked. The bulk-cancel feature will simply
    // operate per-row rather than per-series.
    if (input.series_id && /series_id/i.test(error.message || '')) {
      delete payload.series_id;
      const retry = await supabase.from('lessons').insert(payload).select('*').single();
      if (retry.error) throw retry.error;
      return lessonFromRow(retry.data);
    }
    // Same idea for Migration 032 (lesson_type) not being applied yet.
    if (/lesson_type/i.test(error.message || '')) {
      delete payload.lesson_type;
      const retry = await supabase.from('lessons').insert(payload).select('*').single();
      if (retry.error) throw retry.error;
      return lessonFromRow(retry.data);
    }
    // Same idea for Migration 033 (quoted_amount) not being applied yet.
    if (/quoted_amount/i.test(error.message || '')) {
      delete payload.quoted_amount;
      const retry = await supabase.from('lessons').insert(payload).select('*').single();
      if (retry.error) throw retry.error;
      return lessonFromRow(retry.data);
    }
    throw error;
  }
  return lessonFromRow(data);
}

export type UpdateLessonInput = Partial<{
  date: string;
  start_time: string;
  end_time: string;
  topic: string;
  lesson_type: string;
  pickup_address: string;
  test_centre: string;
  /** The test's start as a timestamp; null clears it. */
  test_start: string | null;
  travel_minutes: number;
  notes: string;
  driving_faults: number;
  serious_faults: number;
  dangerous_faults: number;
  grade: number;
  amount_paid: number;
  quoted_amount: number;
  payment_method: 'bank_transfer' | 'card' | 'cash' | null;
  status: LessonStatus;
  pre_check_completed_at: string;
  cancellation_charge: number | null;
  cancellation_note: string | null;
  plan_topics: string[];
  plan_covered: string[];
  plan_brief: string | null;
}>;

export async function updateLesson(id: string, patch: UpdateLessonInput): Promise<Lesson | undefined> {
  const dbPatch: Record<string, any> = {};
  if (patch.topic !== undefined) dbPatch.topic = patch.topic;
  if (patch.lesson_type !== undefined) dbPatch.lesson_type = patch.lesson_type;
  if (patch.pickup_address !== undefined) dbPatch.pickup_address = patch.pickup_address || null;
  if (patch.test_centre !== undefined) dbPatch.test_centre = patch.test_centre || null;
  if (patch.test_start !== undefined) dbPatch.test_start = patch.test_start;
  if (patch.travel_minutes !== undefined) dbPatch.travel_minutes = patch.travel_minutes;
  if (patch.notes !== undefined) dbPatch.notes = patch.notes;
  if (patch.driving_faults !== undefined) dbPatch.driving_faults = patch.driving_faults;
  if (patch.serious_faults !== undefined) dbPatch.serious_faults = patch.serious_faults;
  if (patch.dangerous_faults !== undefined) dbPatch.dangerous_faults = patch.dangerous_faults;
  if (patch.grade !== undefined) dbPatch.grade = patch.grade;
  if (patch.amount_paid !== undefined) dbPatch.amount_paid = patch.amount_paid;
  if (patch.payment_method !== undefined) dbPatch.payment_method = patch.payment_method;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.pre_check_completed_at !== undefined) dbPatch.pre_check_completed_at = patch.pre_check_completed_at;
  if (patch.cancellation_charge !== undefined) dbPatch.cancellation_charge = patch.cancellation_charge;
  if (patch.cancellation_note !== undefined) dbPatch.cancellation_note = patch.cancellation_note;
  if (patch.plan_topics !== undefined) dbPatch.plan_topics = patch.plan_topics;
  if (patch.plan_covered !== undefined) dbPatch.plan_covered = patch.plan_covered;
  if (patch.plan_brief !== undefined) dbPatch.plan_brief = patch.plan_brief;

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
// SERIES helpers — bulk operations on recurring lessons (Migration 016)
// =============================================================================

export type SeriesSummary = {
  series_id: string;
  total: number;     // total occurrences in the series (any status)
  upcoming: number;  // remaining Scheduled occurrences from a given pivot
};

/**
 * Counts how many Scheduled occurrences of `seriesId` start at or after
 * `fromIso`. Used to power the "Cancel all 3 remaining lessons" CTA wording.
 */
export async function countUpcomingInSeries(seriesId: string, fromIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('lessons')
    .select('id', { count: 'exact', head: true })
    .eq('series_id', seriesId)
    .eq('status', 'Scheduled')
    .gte('start_time', fromIso);
  if (error) {
    // Pre-migration 016 path: column doesn't exist → treat as zero.
    if (/series_id/i.test(error.message || '')) return 0;
    throw error;
  }
  return count || 0;
}

/**
 * Bulk-cancels every Scheduled occurrence of `seriesId` that starts at or
 * after `fromIso`. Returns the number of rows affected. Used by the
 * "Cancel all remaining in series" CTA in LessonToolsSheet.
 *
 * Charge / note semantics:
 *   • charge defaults to 0 (waived) — bulk cancellations are typically the
 *     instructor stepping away from a series, not chasing every student for
 *     a fee. Override per-call if needed.
 *   • cancellation_note is human-readable and includes the series_id tail
 *     so the audit trail is searchable.
 */
export async function cancelSeriesFromDate(
  seriesId: string,
  fromIso: string,
  opts?: { charge?: number; note?: string },
): Promise<number> {
  const charge = opts?.charge ?? 0;
  const note = opts?.note ?? `Cancelled — bulk cancel of recurring series (…${seriesId.slice(-6)})`;
  const { data, error } = await supabase
    .from('lessons')
    .update({
      status: 'Cancelled',
      amount_paid: charge,
      cancellation_charge: charge,
      cancellation_note: note,
    })
    .eq('series_id', seriesId)
    .eq('status', 'Scheduled')
    .gte('start_time', fromIso)
    .select('id');
  if (error) throw error;
  return (data || []).length;
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
  /** False for a topic still at its seeded starting values (never assessed); the row is only changed when the instructor assesses it. */
  touched?: boolean;
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

/** A row counts as assessed once it has been changed after it was created (the seed writes both stamps together). */
export function wasEdited(createdAt?: string | null, updatedAt?: string | null): boolean {
  const c = Date.parse(createdAt || '');
  const u = Date.parse(updatedAt || '');
  if (Number.isNaN(c) || Number.isNaN(u)) return true; // can't tell: don't hide real data
  return u - c > 5000;
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
    touched: wasEdited(r.created_at, r.updated_at),
    // Back-compat aliases
    key:  category_key,
    name: category_name,
    icon: ICON_BY_KEY[category_key] || 'circle',
    skills: deriveSkills(category_name, level, progress),
  };
};

export async function listCompetencies(studentId: string): Promise<Competency[]> {
  // Skip mockDb sentinel IDs to avoid pointless HTTP 400s on Supabase.
  if (!studentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) {
    return [];
  }
  const { data, error } = await supabase
    .from('dvsa_syllabus_tracking')
    .select('*')
    .eq('student_id', studentId)
    .order('category_key', { ascending: true });
  if (error) throw error;
  return (data || []).map(competencyFromRow);
}

// Cross-student competency records for pattern detection — "which DVSA
// categories are several of my students currently weak on". RLS already
// permits an instructor to read every tracking row for their own assigned
// students in one query (not just one student at a time), so this is a
// single round trip rather than N per-student calls.
export async function listCompetenciesForStudents(studentIds: string[]): Promise<Competency[]> {
  const validIds = studentIds.filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (validIds.length === 0) return [];
  const { data, error } = await supabase
    .from('dvsa_syllabus_tracking')
    .select('*')
    .in('student_id', validIds);
  if (error) throw error;
  return (data || []).map(competencyFromRow);
}

export async function seedCompetenciesIfEmpty(studentId: string): Promise<number> {
  // Guard against mockDb sentinel IDs (won't cast to UUID at PostgREST).
  if (!studentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) {
    return 0;
  }
  const existing = await listCompetencies(studentId);
  if (existing.length > 0) return 0;

  // Precheck ownership BEFORE attempting the INSERT. RLS on
  // `dvsa_syllabus_tracking` only permits writes when the caller is the
  // student's assigned instructor. If the caller isn't (e.g. an owner
  // browsing another instructor's roster, or a student viewing their own
  // profile), skip silently rather than firing a network request that
  // PostgREST will reject with a noisy HTTP 400. The competencies grid
  // still renders the DVSA baseline via `listCompetencies` fallback.
  try {
    const [studentRes, identity] = await Promise.all([
      supabase
        .from('students')
        .select('instructor_id')
        .eq('id', studentId)
        .maybeSingle(),
      currentInstructorIdentity(),
    ]);
    const assignedInstructorId = (studentRes.data as { instructor_id?: string } | null)?.instructor_id;
    if (!assignedInstructorId || assignedInstructorId !== identity.instructor_id) {
      return 0;
    }
  } catch {
    // Not signed in, no instructor profile, or the student row is unreadable.
    // Either way, we can't seed — bail silently.
    return 0;
  }

  const rows = DVSA_SYLLABUS.map((c) => ({
    student_id: studentId,
    manoeuvre: c.name,
    category_key: c.key,
    category_name: c.name,
    competency_level: 1,
    progress: 0,
  }));
  const { error } = await supabase.from('dvsa_syllabus_tracking').insert(rows);
  if (error) {
    // Should be rare now that we've prechecked ownership — swallow silently.
    return 0;
  }
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
  mood_emoji?: string;
  mood_reason?: string;
  understanding_rating?: number;
  ability_rating?: number;
  created_at: string;
};

const reflectiveFromRow = (r: any): ReflectiveLog => ({
  id: r.id,
  student_id: r.student_id,
  lesson_id: r.lesson_id ?? undefined,
  what_well: r.what_well ?? undefined,
  what_difficult: r.what_difficult ?? undefined,
  next_focus: r.next_focus ?? undefined,
  mood_emoji: r.mood_emoji ?? undefined,
  mood_reason: r.mood_reason ?? undefined,
  understanding_rating: r.understanding_rating ?? undefined,
  ability_rating: r.ability_rating ?? undefined,
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
  mood_emoji?: string;
  mood_reason?: string;
  understanding_rating?: number;
  ability_rating?: number;
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

// The pupil's "Slot alerts" switch. A function rather than an update: pupils cannot update
// their own student record (migration 063). Returns the saved value.
export async function setMySlotAlerts(on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_my_slot_alerts', { p_on: on });
  if (error) throw error;
  return data === true;
}

// The instructor's default travel buffer, in minutes: what a new lesson starts with, and what the
// diary draws after a lesson. Functions because only a school owner may update the instructors table
// directly, but every instructor may change their own default (migration 071).
export async function getMyDefaultTravelMinutes(): Promise<number> {
  const { data, error } = await supabase.rpc('get_my_default_travel_minutes');
  if (error) throw error;
  return typeof data === 'number' ? data : 15;
}

export async function setMyDefaultTravelMinutes(minutes: number): Promise<number> {
  const { data, error } = await supabase.rpc('set_my_default_travel_minutes', { p_minutes: minutes });
  if (error) throw error;
  return typeof data === 'number' ? data : minutes;
}

// Whether the 24-hour lesson reminder mentions a pupil's unpaid balance (off by default; migration 075).
export async function getMyReminderBalanceSetting(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_my_reminder_balance_setting');
  if (error) throw error;
  return data === true;
}

export async function setMyReminderBalanceSetting(on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_my_reminder_balance_setting', { p_on: on });
  if (error) throw error;
  return data === true;
}

// What happened to the slot alert for one of the instructor's cancelled lessons: when it was
// handled and how many pupils were told. A function because slot_alert_log is backend-only
// (migrations 064 and 065). null when the lesson is not the caller's.
export async function getSlotAlertStatus(lessonId: string): Promise<SlotAlertStatus> {
  const { data, error } = await supabase.rpc('slot_alert_status', { p_lesson_id: lessonId });
  if (error) throw error;
  return (data as SlotAlertStatus) ?? null;
}

// A pupil passing the in-app theory practice test. A function rather than an insert: pupils
// have no INSERT policy on badges_earned, so the old direct insert was always refused
// (migration 062). Awards only the 'theory_passed' badge, once, for the caller's own record.
export async function awardMyTheoryBadge(): Promise<void> {
  const { error } = await supabase.rpc('award_my_theory_badge');
  if (error) throw error;
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
  /** The money these hours stand for: their own amount, or the payment they were added with (Migration 089). */
  money?: number;
  purchased_at: string;
  notes?: string;
};

// Bulk hours-balance fetch for a whole roster at once — one query instead
// of N, same pattern as listCompetenciesForStudents. Returns available
// prepaid hours per student (hours_paid - hours_used, summed across all
// their block bookings), so it can be shown inline on a student list
// without opening each profile individually.
export async function listHoursBalanceForStudents(studentIds: string[]): Promise<Record<string, number>> {
  if (studentIds.length === 0) return {};
  const { data, error } = await supabase
    .from('block_bookings')
    .select('student_id, hours_paid, hours_used')
    .in('student_id', studentIds);
  if (error) {
    // Non-fatal — the list still renders fine without balances if this fails.
    console.warn('[hours-balance] listHoursBalanceForStudents failed:', error.message);
    return {};
  }
  const totals: Record<string, number> = {};
  for (const row of data || []) {
    const net = Number(row.hours_paid) - Number(row.hours_used);
    totals[row.student_id] = (totals[row.student_id] || 0) + net;
  }
  return totals;
}

export async function listBlockBookings(studentId: string): Promise<BlockBooking[]> {
  // The view adds money_gbp (hours added with a payment carry that payment's amount, Migration 089). If it can't be
  // read, the plain table still gives the hours.
  let { data, error } = await supabase
    .from('block_bookings_with_money')
    .select('*')
    .eq('student_id', studentId)
    .order('purchased_at', { ascending: false });
  if (error) {
    ({ data, error } = await supabase
      .from('block_bookings')
      .select('*')
      .eq('student_id', studentId)
      .order('purchased_at', { ascending: false }));
  }
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    student_id: r.student_id,
    hours_paid: Number(r.hours_paid),
    hours_used: Number(r.hours_used),
    amount: Number(r.amount),
    money: Number(r.money_gbp ?? r.amount),
    purchased_at: r.purchased_at,
    notes: r.notes ?? undefined,
  }));
}

export async function addBlockBooking(input: {
  /** Optional caller-chosen id. A retry of the same attempt reuses it, so if the first try did land the retry is refused as a duplicate instead of adding the hours twice. */
  id?: string;
  student_id: string;
  hours_paid: number;
  amount: number;
  notes?: string;
  payment_method?: 'bank_transfer' | 'card' | 'cash' | null;
  /** The payment these hours were added with, so the Wallet can show its amount (Migration 089). */
  payment_id?: string | null;
}): Promise<BlockBooking> {
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
// PAYMENTS (migration 072): money received from a pupil, recorded by hand. There are no in-app card
// payments. Writes go through functions so the school, the recorder and the rules come from the database.
// =============================================================================

const paymentFromRow = (r: any): PaymentRow => ({
  id: r.id,
  amount: Number(r.amount),
  method: r.method,
  paid_at: r.paid_at,
  reference: r.reference ?? null,
  note: r.note ?? null,
  source: r.source,
  voided_at: r.voided_at ?? null,
  void_reason: r.void_reason ?? null,
  date_changed_at: r.date_changed_at ?? null,
  original_paid_at: r.original_paid_at ?? null,
});

/** Newest first, including voided ones (they show struck through). Row security limits this to your own pupils. */
export async function listPayments(studentId: string): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('id, amount, method, paid_at, reference, note, source, voided_at, void_reason, date_changed_at, original_paid_at')
    .eq('student_id', studentId)
    .order('paid_at', { ascending: false });
  if (error) throw error;
  // Payments on lessons that prepaid hours fully cover are not counted again (Migration 088). If this lookup
  // fails the list still loads, just without the note.
  let covered = new Set<string>();
  try {
    const { data: cov } = await supabase.from('payment_prepaid_cover').select('payment_id').eq('student_id', studentId);
    covered = new Set((cov || []).map((c: any) => String(c.payment_id)));
  } catch { /* leave the note off */ }
  return (data || []).map((r) => ({ ...paymentFromRow(r), covered_by_prepaid: covered.has(String(r.id)) }));
}

export type PupilBalance = { charged: number; paid: number; outstanding: number };

export async function getPupilBalance(studentId: string): Promise<PupilBalance> {
  const { data, error } = await supabase
    .from('students_with_balance')
    .select('charged_gbp, paid_gbp, outstanding_gbp')
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) throw error;
  return {
    charged: Number(data?.charged_gbp ?? 0),
    paid: Number(data?.paid_gbp ?? 0),
    outstanding: Number(data?.outstanding_gbp ?? 0),
  };
}

/** The pupil's own 1 to 5 confidence rating for a finished lesson. */
export async function rateLessonConfidence(lessonId: string, score: number): Promise<void> {
  const { error } = await supabase.rpc('rate_lesson_confidence', { p_lesson_id: lessonId, p_score: score });
  if (error) throw error;
}

export async function recordPayment(input: {
  /** A retry of the same attempt reuses this id, so the payment can't be recorded twice. */
  id?: string;
  studentId: string;
  amount: number;
  method: PaymentMethod;
  paidAt?: string | null;
  reference?: string | null;
  note?: string | null;
}): Promise<PaymentRow> {
  const { data, error } = await supabase.rpc('record_payment', {
    p_student_id: input.studentId,
    p_amount: input.amount,
    p_method: input.method,
    p_paid_at: input.paidAt ?? null,
    p_reference: input.reference ?? null,
    p_note: input.note ?? null,
    p_id: input.id ?? null,
  });
  if (error) throw error;
  return paymentFromRow(data);
}

export async function voidPayment(id: string, reason?: string | null): Promise<PaymentRow> {
  const { data, error } = await supabase.rpc('void_payment', { p_id: id, p_reason: reason ?? null });
  if (error) throw error;
  return paymentFromRow(data);
}

/** Changes the date a payment was received (migration 080). The amount and method stay as recorded. */
export async function updatePaymentDate(id: string, paidAt: string): Promise<PaymentRow> {
  const { data, error } = await supabase.rpc('update_payment_date', { p_id: id, p_paid_at: paidAt });
  if (error) throw error;
  return paymentFromRow(data);
}

export type MyPaymentSummary = {
  charged: number;
  paid: number;
  balance: number;
  payments: { id: string; amount: number; method: string; paid_at: string; reference: string | null }[];
  topups: { id: string; amount: number; hours: number; at: string; method: string | null }[];
};

/** The signed-in pupil's own balance and history, or null when the login isn't linked to a pupil. */
export async function getMyPaymentSummary(): Promise<MyPaymentSummary | null> {
  const { data, error } = await supabase.rpc('my_payment_summary');
  if (error) throw error;
  if (!data) return null;
  return {
    charged: Number(data.charged ?? 0),
    paid: Number(data.paid ?? 0),
    balance: Number(data.balance ?? 0),
    payments: (data.payments || []).map((p: any) => ({ id: p.id, amount: Number(p.amount), method: p.method, paid_at: p.paid_at, reference: p.reference ?? null })),
    topups: (data.topups || []).map((k: any) => ({ id: k.id, amount: Number(k.amount), hours: Number(k.hours), at: k.at, method: k.method ?? null })),
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

// A pupil's own mobile number, pickup address, postcode and provisional licence number.
// A function rather than a table update: pupils have no UPDATE policy on students (they could
// then change their own rate or status), so migration 059 gives them this narrow write.
export async function updateMyStudentDetails(input: {
  phone: string; address: string; postcode: string; licence: string;
}): Promise<{ phone: string; address: string; postcode: string; provisional_licence: string }> {
  const { data, error } = await supabase.rpc('update_my_student_details', {
    p_phone: input.phone, p_address: input.address, p_postcode: input.postcode, p_licence: input.licence,
  });
  if (error) throw error;
  return data as any;
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

// Phase 2 of the "not using the app" indicator (23 Sept 2026), per Grant
// directly — stamps the signed-in student's own row every time the
// student app launches (called from AuthContext.tsx, mirroring how
// registerExpoPushToken() is already wired there for the exact same
// student?.id-keyed effect). Deliberately a no-op on any error — an
// activity timestamp failing to write should never surface as a visible
// problem to a student just opening the app. Pupils have no UPDATE policy on
// students, so this goes through the stamp_my_activity RPC (migration 066),
// which only touches the caller's own row. The parameter is kept for callers.
export async function stampStudentActivity(_authUserId: string): Promise<void> {
  try {
    await supabase.rpc('stamp_my_activity');
  } catch {
    // Silently ignored — see comment above.
  }
}


// =============================================================================
// EXPENSE RECEIPTS (Digital Receipt Scanner)
// =============================================================================
export type ReceiptCategory =
  | 'fuel' | 'maintenance' | 'car_wash' | 'parking' | 'tolls'
  | 'mot'  | 'insurance'   | 'lesson_supplies' | 'other';

export type ReceiptCategoryTint = {
  bg: string;
  border: string;
  icon: string;
  text: string;
};

export const RECEIPT_CATEGORIES: { key: ReceiptCategory; label: string; emoji: string; tint: ReceiptCategoryTint }[] = [
  { key: 'fuel',            label: 'Fuel',            emoji: '\u26FD',
    tint: { bg: '#FEF2F2', border: '#FCA5A5', icon: '#B91C1C', text: '#7F1D1D' } },
  { key: 'maintenance',     label: 'Maintenance',     emoji: '\uD83D\uDD27',
    tint: { bg: '#F9FAFB', border: '#E5E7EB', icon: '#6B7280', text: '#374151' } },
  { key: 'car_wash',        label: 'Car wash',        emoji: '\uD83E\uDDFC',
    tint: { bg: '#FDF4FF', border: '#E9A6F5', icon: '#A21CAF', text: '#701A75' } },
  { key: 'parking',         label: 'Parking',         emoji: '\uD83C\uDD7F\uFE0F',
    tint: { bg: '#EFF6FF', border: '#93C5FD', icon: '#1D4ED8', text: '#1E3A8A' } },
  { key: 'tolls',           label: 'Tolls',           emoji: '\uD83D\uDEE3\uFE0F',
    tint: { bg: '#F5F3FF', border: '#C4B5FD', icon: '#6D28D9', text: '#4C1D95' } },
  { key: 'mot',             label: 'MOT',             emoji: '\uD83D\uDCDD',
    tint: { bg: '#FFFBEB', border: '#FCD34D', icon: '#B45309', text: '#78350F' } },
  { key: 'insurance',       label: 'Insurance',       emoji: '\uD83D\uDEE1\uFE0F',
    tint: { bg: '#EFF6FF', border: '#93C5FD', icon: '#1D4ED8', text: '#1E3A8A' } },
  { key: 'lesson_supplies', label: 'Lesson supplies', emoji: '\uD83D\uDCDA',
    tint: { bg: '#F0FDF4', border: '#86EFAC', icon: '#15803D', text: '#14532D' } },
  { key: 'other',           label: 'Other',           emoji: '\uD83D\uDCC4',
    tint: { bg: '#F9FAFB', border: '#E5E7EB', icon: '#6B7280', text: '#374151' } },
];

export type ExpenseReceipt = {
  id: string;
  school_id: string;
  instructor_id: string;
  vehicle_id: string | null;
  category: ReceiptCategory;
  vendor: string | null;
  occurred_at: string;        // YYYY-MM-DD
  amount_total: number;
  vat_amount: number | null;
  currency: string;
  storage_path: string | null;
  ocr_raw_text: string | null;
  notes: string | null;
  created_at: string;
  signed_url?: string | null; // computed at fetch time
};

const receiptFromRow = (r: any): ExpenseReceipt => ({
  id: r.id,
  school_id: r.school_id,
  instructor_id: r.instructor_id,
  vehicle_id: r.vehicle_id ?? null,
  category: r.category as ReceiptCategory,
  vendor: r.vendor ?? null,
  occurred_at: r.occurred_at,
  amount_total: Number(r.amount_total ?? 0),
  vat_amount: r.vat_amount != null ? Number(r.vat_amount) : null,
  currency: r.currency ?? 'GBP',
  storage_path: r.storage_path ?? null,
  ocr_raw_text: r.ocr_raw_text ?? null,
  notes: r.notes ?? null,
  created_at: r.created_at,
});

export async function listReceipts(): Promise<ExpenseReceipt[]> {
  const { data, error } = await supabase
    .from('expense_receipts')
    .select('*')
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    if (/relation .*expense_receipts.* does not exist/i.test(error.message || '')) {
      throw new Error('Please apply Migration 008 first (expense_receipts table).');
    }
    throw error;
  }
  return (data || []).map(receiptFromRow);
}

export type CreateReceiptInput = {
  category: ReceiptCategory;
  vendor?: string | null;
  occurred_at: string;          // YYYY-MM-DD
  amount_total: number;
  vat_amount?: number | null;
  vehicle_id?: string | null;
  storage_path?: string | null; // path inside `receipts` bucket
  ocr_raw_text?: string | null;
  notes?: string | null;
};

export async function createReceipt(input: CreateReceiptInput): Promise<ExpenseReceipt> {
  const { schoolId, instructorId } = await ownContext();
  const payload = {
    school_id: schoolId,
    instructor_id: instructorId,
    vehicle_id: input.vehicle_id ?? null,
    category: input.category,
    vendor: input.vendor?.trim() || null,
    occurred_at: input.occurred_at,
    amount_total: input.amount_total,
    vat_amount: input.vat_amount ?? null,
    currency: 'GBP',
    storage_path: input.storage_path ?? null,
    ocr_raw_text: input.ocr_raw_text ?? null,
    notes: input.notes?.trim() || null,
  };
  const { data, error } = await supabase
    .from('expense_receipts')
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    if (/relation .*expense_receipts.* does not exist/i.test(error.message || '')) {
      throw new Error('Please apply Migration 008 first (expense_receipts table).');
    }
    throw error;
  }
  return receiptFromRow(data);
}

export async function deleteReceipt(id: string, storagePath?: string | null): Promise<void> {
  const { error } = await supabase.from('expense_receipts').delete().eq('id', id);
  if (error) throw error;
  if (storagePath) {
    // Best-effort image cleanup; ignore failures (RLS / already-gone).
    try { await supabase.storage.from('receipts').remove([storagePath]); } catch {}
  }
}

// Upload a receipt image (base64) into the `receipts` bucket under the
// instructor's school folder. Returns the storage path.
export async function uploadReceiptImage(
  base64: string,
  mimeType: string = 'image/jpeg',
): Promise<string> {
  const { schoolId } = await ownContext();
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const id  = (globalThis.crypto && (globalThis.crypto as any).randomUUID)
    ? (globalThis.crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${schoolId}/${id}.${ext}`;

  // Decode base64 -> Uint8Array in a way that works on web + native.
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
  const bin = (() => {
    if (typeof atob === 'function') {
      const raw = atob(cleaned);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return arr;
    }
    return new Uint8Array(Buffer.from(cleaned, 'base64'));
  })();

  const { error } = await supabase
    .storage
    .from('receipts')
    .upload(path, bin, { contentType: mimeType, upsert: false });
  if (error) throw error;
  return path;
}

// Generate a short-lived signed URL for displaying a stored receipt image.
export async function getReceiptSignedUrl(path: string, expiresSec = 600): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, expiresSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}


// =============================================================================
// Multi-instructor — owner detection
// =============================================================================
export async function isCurrentUserSchoolOwner(): Promise<boolean> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) return false;
  const { data, error } = await supabase
    .from('driving_schools')
    .select('id, owner_auth_id')
    .eq('owner_auth_id', uid)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

// =============================================================================
// School profile (Migration 027) — business name, logo, contact details.
// Editable by the school's owner only; RLS on driving_schools already
// restricts UPDATE to rows the caller owns.
// =============================================================================

export type SchoolProfile = {
  id: string;
  business_name: string;
  logo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  default_hourly_rate: number | null;
  google_review_url: string | null;
  tier: string;
  // Instructor-editable T&Cs (2 Sept 2026) — per-school, freeform. Null
  // means the school hasn't set their own text yet.
  pupil_agreement_text: string | null;
  /** Whether pupils see the car (make, plate, gearbox) on their Instructor tab. */
  share_vehicle_with_pupils: boolean;
};

export async function getMySchoolProfile(): Promise<SchoolProfile | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('driving_schools')
    .select('id, business_name, logo_url, contact_email, contact_phone, address, default_hourly_rate, google_review_url, tier, pupil_agreement_text, share_vehicle_with_pupils')
    .eq('owner_auth_id', uid)
    .maybeSingle();
  if (error) throw error;
  return (data as SchoolProfile) || null;
}

// The school's refund policy for prepaid hours (Migration 054). Solo instructors are
// their own school's owner, so this reads and writes their own school row.
export async function getMyRefundPolicy(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('driving_schools')
    .select('refund_policy')
    .eq('owner_auth_id', uid)
    .maybeSingle();
  if (error) throw error;
  return (data?.refund_policy as string | undefined) ?? null;
}

export async function updateMySchoolProfile(patch: Partial<{
  business_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  default_hourly_rate: number | null;
  google_review_url: string | null;
  pupil_agreement_text: string | null;
  refund_policy: string;
  share_vehicle_with_pupils: boolean;
}>): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase
    .from('driving_schools')
    .update(patch)
    .eq('owner_auth_id', uid);
  if (error) throw error;
}

// Uploads a logo image (base64, no data: prefix) to the school-logos bucket
// under "<school_id>/logo.<ext>" — overwriting any existing logo — then
// saves the resulting public URL onto the school's row.
// Any instructor at a school can read their own school's pupil agreement
// text (ds_instructor_read RLS policy already allows this) — unlike
// getMySchoolProfile() above, which is owner-only. Added 2 Sept 2026 so a
// regular (non-owner) instructor signing onboarding-tc-screen sees their
// school's actual terms, not just the owner.
// What the signed-in student's Pupil Agreement needs: their instructor's and
// business's contact details, their own hourly rate, and the school's own
// agreement wording (null when the school has not written any). A function rather
// than table reads because students cannot read instructors or driving_schools
// (Migration 053).
export async function getMyPupilAgreementContext(): Promise<AgreementContext | null> {
  const { data, error } = await supabase.rpc('my_pupil_agreement_context');
  if (error) throw error;
  return (data as AgreementContext | null) ?? null;
}

// What the pupil's Instructor tab shows: name, ADI number, business contact details and
// (if the school shares it) the car. A function rather than table reads, because pupils
// cannot read instructors, driving_schools or vehicles (migration 060).
export async function getMyInstructorCard(): Promise<InstructorCardData | null> {
  const { data, error } = await supabase.rpc('my_instructor_card');
  if (error) throw error;
  return (data as InstructorCardData | null) ?? null;
}

export async function uploadSchoolLogo(schoolId: string, base64: string, mimeType: string): Promise<string> {
  // Deliberately a fixed path with no extension, regardless of the source
  // image's format — Supabase Storage serves the correct Content-Type from
  // what's set at upload time below, so a file extension isn't functionally
  // needed for correct rendering. This guarantees every upload for this
  // school truly overwrites the same file, rather than risking two
  // different files (logo.png, then logo.jpg) if someone uploads a PNG and
  // later a JPG — which would silently leave the old one as orphaned
  // storage while still technically "working" for display.
  const path = `${schoolId}/logo`;

  // Decode base64 -> Uint8Array in a way that works on web + native (same
  // approach as uploadReceiptImage above).
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
  const bytes = (() => {
    if (typeof atob === 'function') {
      const raw = atob(cleaned);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return arr;
    }
    return new Uint8Array(Buffer.from(cleaned, 'base64'));
  })();

  const { error: uploadError } = await supabase.storage
    .from('school-logos')
    .upload(path, bytes, { contentType: mimeType, upsert: true });
  if (uploadError) throw uploadError;
  const { data: pub } = supabase.storage.from('school-logos').getPublicUrl(path);
  // Cache-bust so the new logo shows immediately instead of a stale CDN copy.
  const url = `${pub.publicUrl}?v=${Date.now()}`;
  const { error: updateError } = await supabase
    .from('driving_schools')
    .update({ logo_url: url })
    .eq('id', schoolId);
  if (updateError) throw updateError;
  return url;
}

// =============================================================================
// LESSON PACKAGES (instructor pricing)
// =============================================================================
export type LessonPackage = {
  id: string;
  school_id: string;
  instructor_id: string;
  name: string;
  hours: number;
  price: number | null;
  description: string | null;
  topic_tag: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const pkgFromRow = (r: any): LessonPackage => ({
  id: r.id,
  school_id: r.school_id,
  instructor_id: r.instructor_id,
  name: r.name,
  hours: Number(r.hours ?? 0),
  price: r.price != null ? Number(r.price) : null,
  description: r.description ?? null,
  topic_tag: r.topic_tag ?? null,
  active: !!r.active,
  sort_order: Number(r.sort_order ?? 0),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export async function listLessonPackages(opts?: { activeOnly?: boolean; instructorId?: string }): Promise<LessonPackage[]> {
  let q = supabase
    .from('lesson_packages')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('hours', { ascending: true });
  if (opts?.activeOnly) q = q.eq('active', true);
  if (opts?.instructorId) q = q.eq('instructor_id', opts.instructorId);
  const { data, error } = await q;
  if (error) {
    if (/relation .*lesson_packages.* does not exist/i.test(error.message || '')) {
      throw new Error('Please apply Migration 010 first (lesson_packages table).');
    }
    throw error;
  }
  return (data || []).map(pkgFromRow);
}

export async function createLessonPackage(input: {
  name: string;
  hours: number;
  price?: number | null;
  description?: string | null;
  topic_tag?: string | null;
  active?: boolean;
  sort_order?: number;
}): Promise<LessonPackage> {
  const { schoolId, instructorId } = await ownContext();
  const { data, error } = await supabase
    .from('lesson_packages')
    .insert({
      school_id: schoolId,
      instructor_id: instructorId,
      name: input.name.trim(),
      hours: input.hours,
      price: input.price ?? null,
      description: input.description?.trim() || null,
      topic_tag: input.topic_tag?.trim() || null,
      active: input.active ?? true,
      sort_order: input.sort_order ?? 999,
    })
    .select('*')
    .single();
  if (error) throw error;
  return pkgFromRow(data);
}

export async function updateLessonPackage(id: string, patch: Partial<{
  name: string;
  hours: number;
  price: number | null;
  description: string | null;
  topic_tag: string | null;
  active: boolean;
  sort_order: number;
}>): Promise<LessonPackage> {
  const dbPatch: Record<string, any> = {};
  if (patch.name !== undefined)        dbPatch.name = patch.name.trim();
  if (patch.hours !== undefined)       dbPatch.hours = patch.hours;
  if (patch.price !== undefined)       dbPatch.price = patch.price;
  if (patch.description !== undefined) dbPatch.description = patch.description?.trim() || null;
  if (patch.topic_tag !== undefined)   dbPatch.topic_tag = patch.topic_tag?.trim() || null;
  if (patch.active !== undefined)      dbPatch.active = patch.active;
  if (patch.sort_order !== undefined)  dbPatch.sort_order = patch.sort_order;
  const { data, error } = await supabase
    .from('lesson_packages')
    .update(dbPatch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return pkgFromRow(data);
}

export async function deleteLessonPackage(id: string): Promise<void> {
  // .select('id') so we can tell a real delete from an RLS-filtered no-op,
  // which Supabase reports as success with zero rows.
  const { data, error } = await supabase.from('lesson_packages').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('That package could not be deleted — it may already be gone, or you may not have permission.');
  }
}

// =============================================================================
// INSTRUCTOR DEFAULT HOURLY RATE
// =============================================================================
// This one value, set on Pricing & packages, is what new pupils start on (addStudent), what the diary's
// billable figure uses, and what "apply to my pupils" moves pupils to. Read and set through functions
// (migration 076) because only a school owner can update the instructors table directly.
export async function getInstructorHourlyRate(): Promise<number> {
  const { data, error } = await supabase.rpc('get_my_default_hourly_rate');
  if (error) throw error;
  const n = Number(data);
  return Number.isFinite(n) && n > 0 ? n : 36;
}

export async function updateInstructorHourlyRate(rate: number): Promise<void> {
  const { error } = await supabase.rpc('set_my_default_hourly_rate', { p_rate: rate });
  if (error) throw error;
}

/** How many of the instructor's pupils are on each hourly rate. */
export async function getPupilRateCounts(): Promise<{ rate: number; pupils: number }[]> {
  const { data, error } = await supabase.rpc('my_pupil_rate_counts');
  if (error) throw error;
  return ((data as any[]) || []).map((r) => ({ rate: Number(r.rate), pupils: Number(r.pupils) }));
}

/** Moves the instructor's pupils to a rate: only those on `onlyOldRate` when given, otherwise everyone. Returns how many changed. */
export async function applyDefaultRateToMyPupils(rate: number, onlyOldRate?: number): Promise<number> {
  const { data, error } = await supabase.rpc('apply_default_rate_to_my_pupils', { p_rate: rate, p_only_old_rate: onlyOldRate ?? null });
  if (error) throw error;
  return Number(data) || 0;
}


// ===========================================================================
// Availability blocks (Migration 013) — instructor unavailabilities
// ===========================================================================

export type AvailabilityCategory = 'holiday' | 'personal' | 'family' | 'sick' | 'other';

export type AvailabilityBlock = {
  id: string;
  instructor_id: string;
  school_id: string | null;
  starts_at: string;   // ISO timestamptz
  ends_at: string;     // ISO timestamptz
  all_day: boolean;
  category: AvailabilityCategory;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AddAvailabilityBlockInput = {
  starts_at: string;
  ends_at: string;
  all_day?: boolean;
  category?: AvailabilityCategory;
  reason?: string | null;
};

/**
 * Resolve the active user's instructor row (via auth.uid()) and current
 * school_id. RLS would prevent inserting against another user's row anyway,
 * but we still need both values to populate the columns on INSERT.
 */
async function currentInstructorIdentity(): Promise<{ instructor_id: string; school_id: string | null }> {
  const { data: ses } = await supabase.auth.getSession();
  const uid = ses.session?.user?.id;
  if (!uid) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('instructors')
    .select('id, school_id')
    .eq('auth_user_id', uid)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('No instructor profile linked to this account');
  return { instructor_id: data.id, school_id: data.school_id ?? null };
}

export async function listAvailabilityBlocks(
  fromIso?: string,
  toIso?: string,
): Promise<AvailabilityBlock[]> {
  let q = supabase
    .from('availability_blocks')
    .select('*')
    .order('starts_at', { ascending: true });
  // Overlap filter: block.ends_at > fromIso AND block.starts_at < toIso.
  if (fromIso) q = q.gt('ends_at', fromIso);
  if (toIso) q = q.lt('starts_at', toIso);
  const { data, error } = await q;
  if (error) {
    const msg = error.message || '';
    if (/availability_blocks/i.test(msg) && /(does not exist|schema cache)/i.test(msg)) {
      throw new Error('Please apply Migration 013 first (availability_blocks table).');
    }
    throw error;
  }
  return (data || []) as AvailabilityBlock[];
}

export async function addAvailabilityBlock(input: AddAvailabilityBlockInput): Promise<AvailabilityBlock> {
  const { instructor_id, school_id } = await currentInstructorIdentity();
  const row = {
    instructor_id,
    school_id,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    all_day: !!input.all_day,
    category: input.category || 'other',
    reason: input.reason ?? null,
  };
  const { data, error } = await supabase
    .from('availability_blocks')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    const msg = error.message || '';
    if (/availability_blocks/i.test(msg) && /(does not exist|schema cache)/i.test(msg)) {
      throw new Error('Please apply Migration 013 first (availability_blocks table).');
    }
    throw error;
  }
  return data as AvailabilityBlock;
}

export async function updateAvailabilityBlock(
  id: string,
  patch: Partial<AddAvailabilityBlockInput>,
): Promise<AvailabilityBlock> {
  const dbPatch: any = {};
  if (patch.starts_at !== undefined) dbPatch.starts_at = patch.starts_at;
  if (patch.ends_at !== undefined) dbPatch.ends_at = patch.ends_at;
  if (patch.all_day !== undefined) dbPatch.all_day = patch.all_day;
  if (patch.category !== undefined) dbPatch.category = patch.category;
  if (patch.reason !== undefined) dbPatch.reason = patch.reason;
  const { data, error } = await supabase
    .from('availability_blocks')
    .update(dbPatch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as AvailabilityBlock;
}

export async function deleteAvailabilityBlock(id: string): Promise<void> {
  const { error } = await supabase
    .from('availability_blocks')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/** Pure helper — does a [startIso, endIso] window overlap any of `blocks`? */
export function overlapsAnyBlock(
  blocks: Pick<AvailabilityBlock, 'starts_at' | 'ends_at'>[],
  startIso: string,
  endIso: string,
): boolean {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  return blocks.some((b) => {
    const bs = new Date(b.starts_at).getTime();
    const be = new Date(b.ends_at).getTime();
    return bs < e && be > s;
  });
}

// ===========================================================================
// Test outcomes (Migration 015) — DVSA theory & practical test results
// ===========================================================================

export type TestType = 'theory' | 'practical';
export type TestResult = 'pass' | 'fail';

/** DVSA common mark-sheet preset chips for retest reasons. */
export const TEST_RETEST_REASONS = [
  'Junctions (observation)',
  'Mirrors (signalling)',
  'Use of speed',
  'Move off (control)',
  'Reverse parking',
  'Roundabouts',
  'Response to signs/signals',
  'Steering',
  'Positioning (normal driving)',
] as const;

export type TestOutcome = {
  id: string;
  instructor_id: string;
  school_id: string | null;
  student_id: string;
  test_type: TestType;
  test_date: string;              // ISO date YYYY-MM-DD
  result: TestResult;
  // Practical
  driving_faults?: number | null;
  serious_faults?: number | null;
  dangerous_faults?: number | null;
  // Theory
  theory_mc_score?: number | null;
  theory_hp_score?: number | null;
  /** Theory pass certificate number (optional), for a passed theory test. */
  theory_certificate_number?: string | null;
  // Both
  test_centre?: string | null;
  examiner_notes?: string | null;
  retest_reasons: string[];
  created_at: string;
  updated_at: string;
};

export type AddTestOutcomeInput = {
  student_id: string;
  test_type: TestType;
  test_date: string;
  result: TestResult;
  driving_faults?: number | null;
  serious_faults?: number | null;
  dangerous_faults?: number | null;
  theory_mc_score?: number | null;
  theory_hp_score?: number | null;
  theory_certificate_number?: string | null;
  test_centre?: string | null;
  examiner_notes?: string | null;
  retest_reasons?: string[];
};

function isMissingTestOutcomesTable(msg: string): boolean {
  return /test_outcomes/i.test(msg) && /(does not exist|schema cache)/i.test(msg);
}

export async function addTestOutcome(input: AddTestOutcomeInput): Promise<TestOutcome> {
  const { instructor_id, school_id } = await currentInstructorIdentity();
  const row: any = {
    instructor_id,
    school_id,
    student_id: input.student_id,
    test_type: input.test_type,
    test_date: input.test_date,
    result: input.result,
    retest_reasons: input.retest_reasons || [],
  };
  if (input.test_centre !== undefined) row.test_centre = input.test_centre;
  if (input.examiner_notes !== undefined) row.examiner_notes = input.examiner_notes;
  if (input.test_type === 'practical') {
    row.driving_faults = input.driving_faults ?? null;
    row.serious_faults = input.serious_faults ?? null;
    row.dangerous_faults = input.dangerous_faults ?? null;
  } else {
    row.theory_mc_score = input.theory_mc_score ?? null;
    row.theory_hp_score = input.theory_hp_score ?? null;
    row.theory_certificate_number = input.theory_certificate_number ?? null;
  }
  const { data, error } = await supabase
    .from('test_outcomes')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    if (isMissingTestOutcomesTable(error.message || '')) {
      throw new Error('Please apply Migration 015 first (test_outcomes table).');
    }
    throw error;
  }
  return data as TestOutcome;
}

export async function listTestOutcomesForStudent(studentId: string): Promise<TestOutcome[]> {
  const { data, error } = await supabase
    .from('test_outcomes')
    .select('*')
    .eq('student_id', studentId)
    .order('test_date', { ascending: false });
  if (error) {
    if (isMissingTestOutcomesTable(error.message || '')) return [];
    throw error;
  }
  return (data || []) as TestOutcome[];
}

export async function listTestOutcomesForInstructor(): Promise<TestOutcome[]> {
  const { instructor_id } = await currentInstructorIdentity();
  const { data, error } = await supabase
    .from('test_outcomes')
    .select('*')
    .eq('instructor_id', instructor_id)
    .order('test_date', { ascending: false });
  if (error) {
    if (isMissingTestOutcomesTable(error.message || '')) return [];
    throw error;
  }
  return (data || []) as TestOutcome[];
}

/**
 * Fetch every test outcome across all instructors in the given school.
 * Used by the Owner Dashboard's "Test performance" card so the owner can
 * see school-wide pass rates and the most recent results in one place.
 */
export async function listTestOutcomesForSchool(schoolId: string): Promise<TestOutcome[]> {
  // First find every instructor in this school
  const { data: insts, error: e1 } = await supabase
    .from('instructors')
    .select('id')
    .eq('school_id', schoolId);
  if (e1) throw e1;
  const ids = (insts || []).map((i: any) => i.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('test_outcomes')
    .select('*')
    .in('instructor_id', ids)
    .order('test_date', { ascending: false });
  if (error) {
    if (isMissingTestOutcomesTable(error.message || '')) return [];
    throw error;
  }
  return (data || []) as TestOutcome[];
}

export async function deleteTestOutcome(id: string): Promise<void> {
  const { error } = await supabase.from('test_outcomes').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Compute aggregate KPIs across an instructor's test history.
 *
 * NOTE: As of the practical-only KPI change, the top-level
 * `total/passes/fails/passRatePct` reflect **practical tests only**.
 * Theory test rows are still stored (instructors may want to record them
 * for personal student tracking) but they no longer affect the headline
 * KPIs on the dashboard. The `theory*` fields remain in the type for
 * backward compatibility but are not used by any of the current cards.
 */
export type TestKpis = {
  total: number;                // = practicalTotal
  passes: number;               // = practicalPasses
  fails: number;                // = practicalTotal - practicalPasses
  passRatePct: number;          // 0–100 integer; practical-only
  practicalTotal: number;
  practicalPasses: number;
  practicalPassRatePct: number;
  /** @deprecated kept only for historical callers; not surfaced in any KPI card. */
  theoryTotal: number;
  /** @deprecated */
  theoryPasses: number;
  /** @deprecated */
  theoryPassRatePct: number;
};

export function computeTestKpis(rows: TestOutcome[]): TestKpis {
  const practical = rows.filter((r) => r.test_type === 'practical');
  const theory = rows.filter((r) => r.test_type === 'theory');
  const pP = practical.filter((r) => r.result === 'pass').length;
  const tP = theory.filter((r) => r.result === 'pass').length;
  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));
  // Top-level KPIs are PRACTICAL-ONLY by design (instructors focus on practical pass).
  return {
    total: practical.length,
    passes: pP,
    fails: practical.length - pP,
    passRatePct: pct(pP, practical.length),
    practicalTotal: practical.length,
    practicalPasses: pP,
    practicalPassRatePct: pct(pP, practical.length),
    theoryTotal: theory.length,
    theoryPasses: tP,
    theoryPassRatePct: pct(tP, theory.length),
  };
}

// ===========================================================================
// DL25 mock test attempts (Migration 024) — student self-practice, kept
// deliberately separate from `test_outcomes` (real DVSA bookings) so it
// never affects the school's official pass-rate KPI.
// ===========================================================================

/** Faults by marking line. Newer attempts use the DL25 items (src/dl25Items.ts) and carry the line's name as label. */
export type MockTestCategoryBreakdown = Record<
  string,
  { driving: number; serious: number; dangerous: number; label?: string }
>;

export type MockTestAttempt = {
  id: string;
  student_id: string;
  taken_at: string;
  driving_faults: number;
  serious_faults: number;
  dangerous_faults: number;
  passed: boolean;
  category_breakdown: MockTestCategoryBreakdown;
  created_at: string;
  /** An AI-written summary the instructor chose to attach (migration 074); the pupil sees it on their home screen. */
  ai_debrief?: string | null;
  ai_debrief_generated_at?: string | null;
  /** The Route Recorder recording this test was run during (migration 093); recordings live on the instructor's phone. */
  route_id?: string | null;
  /** When each fault was marked in a live test (migration 094), as { key, type, t } entries; null for older tests. */
  fault_events?: { key: string; type: 'driving' | 'serious' | 'dangerous'; t: number }[] | null;
};

function isMissingMockTestAttemptsTable(msg: string): boolean {
  return /mock_test_attempts/i.test(msg) && /(does not exist|schema cache)/i.test(msg);
}

export async function addMockTestAttempt(input: {
  student_id: string;
  driving_faults: number;
  serious_faults: number;
  dangerous_faults: number;
  passed: boolean;
  category_breakdown: MockTestCategoryBreakdown;
  route_id?: string;
  fault_events?: { key: string; type: 'driving' | 'serious' | 'dangerous'; t: number }[];
}): Promise<MockTestAttempt> {
  const { data, error } = await supabase
    .from('mock_test_attempts')
    .insert(input)
    .select('*')
    .single();
  if (error) {
    if (isMissingMockTestAttemptsTable(error.message || '')) {
      throw new Error('Please apply Migration 024 first (mock_test_attempts table).');
    }
    throw error;
  }
  return data as MockTestAttempt;
}

/** The mock tests run during one recording, newest first. */
export async function listMockTestAttemptsForRoute(routeId: string): Promise<MockTestAttempt[]> {
  const { data, error } = await supabase
    .from('mock_test_attempts')
    .select('*')
    .eq('route_id', routeId)
    .order('taken_at', { ascending: false });
  if (error) throw error;
  return (data || []) as MockTestAttempt[];
}

export async function listMockTestAttempts(studentId: string): Promise<MockTestAttempt[]> {
  const { data, error } = await supabase
    .from('mock_test_attempts')
    .select('*')
    .eq('student_id', studentId)
    .order('taken_at', { ascending: false });
  if (error) {
    if (isMissingMockTestAttemptsTable(error.message || '')) return [];
    throw error;
  }
  return (data || []) as MockTestAttempt[];
}

// ===========================================================================
// GDPR deletion requests (Migration 026) — a formal, audited "please delete
// my data" request. Deliberately doesn't execute the deletion itself; a
// student's request becomes visible to their instructor (who already has a
// working hard-delete), and an instructor's own request is logged for
// manual follow-up rather than auto-executed, since deleting an
// instructor's account is a bigger operation than this session scoped out.
// ===========================================================================

export type GdprDeletionRequest = {
  id: string;
  requested_by_role: 'student' | 'instructor';
  requested_by_auth_id: string;
  student_id: string | null;
  instructor_id: string | null;
  reason: string | null;
  status: 'pending' | 'completed' | 'declined';
  requested_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

function isMissingGdprTable(msg: string): boolean {
  return /gdpr_deletion_requests/i.test(msg) && /(does not exist|schema cache)/i.test(msg);
}

export async function submitDeletionRequest(input: {
  role: 'student' | 'instructor';
  studentId?: string;
  instructorId?: string;
  reason?: string;
}): Promise<GdprDeletionRequest> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error('Not signed in');
  const row = {
    requested_by_role: input.role,
    requested_by_auth_id: uid,
    student_id: input.role === 'student' ? input.studentId : null,
    instructor_id: input.role === 'instructor' ? input.instructorId : null,
    reason: input.reason?.trim() || null,
  };
  const { data, error } = await supabase
    .from('gdpr_deletion_requests')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    if (isMissingGdprTable(error.message || '')) {
      throw new Error('Please apply Migration 026 first (gdpr_deletion_requests table).');
    }
    throw error;
  }
  return data as GdprDeletionRequest;
}

export async function listMyDeletionRequests(role: 'student' | 'instructor', id: string): Promise<GdprDeletionRequest[]> {
  const column = role === 'student' ? 'student_id' : 'instructor_id';
  const { data, error } = await supabase
    .from('gdpr_deletion_requests')
    .select('*')
    .eq(column, id)
    .order('requested_at', { ascending: false });
  if (error) {
    if (isMissingGdprTable(error.message || '')) return [];
    throw error;
  }
  return (data || []) as GdprDeletionRequest[];
}

// For the instructor side — is there a pending deletion request from this
// specific student? Used to surface a prompt on the student's own profile
// screen rather than requiring the instructor to check a separate inbox.
export async function getPendingDeletionRequestForStudent(studentId: string): Promise<GdprDeletionRequest | null> {
  const { data, error } = await supabase
    .from('gdpr_deletion_requests')
    .select('*')
    .eq('student_id', studentId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingGdprTable(error.message || '')) return null;
    throw error;
  }
  return (data as GdprDeletionRequest) || null;
}

export async function resolveDeletionRequest(requestId: string, status: 'completed' | 'declined', note?: string): Promise<void> {
  const { error } = await supabase
    .from('gdpr_deletion_requests')
    .update({ status, resolved_at: new Date().toISOString(), resolution_note: note?.trim() || null })
    .eq('id', requestId);
  if (error) throw error;
}

// ===========================================================================
// Customizable instructor lesson notes (Migration 029) — the instructor's
// own question set, and their answers for one specific lesson. Deliberately
// separate from reflective_logs (the student's own free-text reflection).
// ===========================================================================

export type LessonNoteQuestion = {
  id: string;
  instructor_id: string;
  question_text: string;
  sort_order: number;
  is_active: boolean;
};

function isMissingLessonNotesTable(msg: string): boolean {
  return /(lesson_note_questions|instructor_lesson_notes)/i.test(msg) && /(does not exist|schema cache)/i.test(msg);
}

// Sensible starting point for an instructor who's never customized their
// questions — not copied verbatim from any one competitor, just a
// reasonable default they're free to change or delete entirely.
const DEFAULT_LESSON_NOTE_QUESTIONS = [
  'What went well this lesson?',
  'What needs more practice?',
  'Goal for next lesson',
];

export async function listMyLessonNoteQuestions(instructorId: string): Promise<LessonNoteQuestion[]> {
  const { data, error } = await supabase
    .from('lesson_note_questions')
    .select('*')
    .eq('instructor_id', instructorId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) {
    if (isMissingLessonNotesTable(error.message || '')) return [];
    throw error;
  }
  if ((data || []).length === 0) {
    // First-time use — seed the sensible defaults so the instructor isn't
    // looking at a completely blank notes screen with no guidance.
    const seeded = await Promise.all(
      DEFAULT_LESSON_NOTE_QUESTIONS.map((text, i) =>
        supabase
          .from('lesson_note_questions')
          .insert({ instructor_id: instructorId, question_text: text, sort_order: i })
          .select('*')
          .single(),
      ),
    );
    return seeded.filter((r) => !r.error).map((r) => r.data as LessonNoteQuestion);
  }
  return (data || []) as LessonNoteQuestion[];
}

export async function addLessonNoteQuestion(instructorId: string, questionText: string): Promise<LessonNoteQuestion> {
  const { data: existing } = await supabase
    .from('lesson_note_questions')
    .select('sort_order')
    .eq('instructor_id', instructorId)
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
  const { data, error } = await supabase
    .from('lesson_note_questions')
    .insert({ instructor_id: instructorId, question_text: questionText.trim(), sort_order: nextOrder })
    .select('*')
    .single();
  if (error) throw error;
  return data as LessonNoteQuestion;
}

export async function updateLessonNoteQuestion(id: string, questionText: string): Promise<void> {
  const { error } = await supabase
    .from('lesson_note_questions')
    .update({ question_text: questionText.trim() })
    .eq('id', id);
  if (error) throw error;
}

// Soft-delete only — never hard-deletes, so past lesson notes that
// reference this question by id still make sense when viewed later.
export async function removeLessonNoteQuestion(id: string): Promise<void> {
  const { error } = await supabase
    .from('lesson_note_questions')
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw error;
}

export async function reorderLessonNoteQuestions(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from('lesson_note_questions').update({ sort_order: i }).eq('id', id),
    ),
  );
}

// Customizable/multiple DVSA syllabuses (2 Sept 2026), per Grant's three
// direct choices: separate, additional syllabuses alongside the standard
// DVSA_SYLLABUS constant (never touched or replaced by any of this), per-
// instructor scope, fully custom categories within each. Same shape and
// soft-delete convention as lesson_note_questions above.

export type InstructorSyllabus = {
  id: string;
  instructor_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type SyllabusCategory = {
  id: string;
  syllabus_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

function isMissingSyllabusTable(msg: string): boolean {
  return /(instructor_syllabuses|instructor_syllabus_categories)/i.test(msg) && /(does not exist|schema cache)/i.test(msg);
}

export async function listMySyllabuses(instructorId: string): Promise<InstructorSyllabus[]> {
  const { data, error } = await supabase
    .from('instructor_syllabuses')
    .select('*')
    .eq('instructor_id', instructorId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) {
    if (isMissingSyllabusTable(error.message || '')) return [];
    throw error;
  }
  return (data || []) as InstructorSyllabus[];
}

export async function addSyllabus(instructorId: string, name: string): Promise<InstructorSyllabus> {
  const { data: existing } = await supabase
    .from('instructor_syllabuses')
    .select('sort_order')
    .eq('instructor_id', instructorId)
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
  const { data, error } = await supabase
    .from('instructor_syllabuses')
    .insert({ instructor_id: instructorId, name: name.trim(), sort_order: nextOrder })
    .select('*')
    .single();
  if (error) throw error;
  return data as InstructorSyllabus;
}

export async function renameSyllabus(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('instructor_syllabuses').update({ name: name.trim() }).eq('id', id);
  if (error) throw error;
}

// Soft-delete only — matches removeLessonNoteQuestion's reasoning: past
// per-student progress recorded against this syllabus's categories still
// makes sense when viewed later even if the syllabus itself is retired.
export async function removeSyllabus(id: string): Promise<void> {
  const { error } = await supabase.from('instructor_syllabuses').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

export async function listSyllabusCategories(syllabusId: string): Promise<SyllabusCategory[]> {
  const { data, error } = await supabase
    .from('instructor_syllabus_categories')
    .select('*')
    .eq('syllabus_id', syllabusId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []) as SyllabusCategory[];
}

export async function addSyllabusCategory(syllabusId: string, name: string): Promise<SyllabusCategory> {
  const { data: existing } = await supabase
    .from('instructor_syllabus_categories')
    .select('sort_order')
    .eq('syllabus_id', syllabusId)
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;
  const { data, error } = await supabase
    .from('instructor_syllabus_categories')
    .insert({ syllabus_id: syllabusId, name: name.trim(), sort_order: nextOrder })
    .select('*')
    .single();
  if (error) throw error;
  return data as SyllabusCategory;
}

export async function renameSyllabusCategory(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('instructor_syllabus_categories').update({ name: name.trim() }).eq('id', id);
  if (error) throw error;
}

export async function removeSyllabusCategory(id: string): Promise<void> {
  const { error } = await supabase.from('instructor_syllabus_categories').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

export async function reorderSyllabusCategories(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from('instructor_syllabus_categories').update({ sort_order: i }).eq('id', id),
    ),
  );
}

// Applies a custom syllabus to a student — seeds dvsa_syllabus_tracking
// rows for each of the syllabus's active categories, using the category's
// own row id as category_key (guarantees no collision with the fixed DVSA
// keys or another custom syllabus's categories, since it's a real uuid).
// Skips categories the student is already being tracked against, so this
// is safe to call again later if the instructor adds more categories to
// an already-applied syllabus.
export async function applySyllabusToStudent(studentId: string, syllabusId: string): Promise<number> {
  const categories = await listSyllabusCategories(syllabusId);
  if (categories.length === 0) return 0;
  const existing = await listCompetencies(studentId);
  const existingKeys = new Set(existing.map((c) => c.category_key));
  const toInsert = categories
    .filter((c) => !existingKeys.has(c.id))
    .map((c) => ({
      student_id: studentId,
      manoeuvre: c.name,
      category_key: c.id,
      category_name: c.name,
      competency_level: 1,
      progress: 0,
    }));
  if (toInsert.length === 0) return 0;
  const { error } = await supabase.from('dvsa_syllabus_tracking').insert(toInsert);
  if (error) throw error;
  return toInsert.length;
}

export type InstructorLessonNote = {
  id: string;
  lesson_id: string;
  student_id: string;
  instructor_id: string;
  answers: Record<string, string>;
  created_at: string;
  updated_at: string;
  // AI-generated debrief (2 Sept 2026) — text version. Null until the
  // instructor generates one from their saved notes.
  ai_debrief: string | null;
  ai_debrief_generated_at: string | null;
};

export async function getLessonNotes(lessonId: string): Promise<InstructorLessonNote | null> {
  const { data, error } = await supabase
    .from('instructor_lesson_notes')
    .select('*')
    .eq('lesson_id', lessonId)
    .maybeSingle();
  if (error) {
    if (isMissingLessonNotesTable(error.message || '')) return null;
    throw error;
  }
  return (data as InstructorLessonNote) || null;
}

/**
 * What the instructor wrote about the pupil's most recent earlier lessons: the answers to the "needs more practice" and
 * "goal" questions, from the latest lesson (before `beforeISO`, up to the last six) that has either. Null if none.
 */
export async function getLastLessonFocus(
  studentId: string, beforeISO: string, questions: LessonNoteQuestion[],
): Promise<{ lessonDate: string; practice: string | null; goal: string | null } | null> {
  const { data: lessons, error } = await supabase
    .from('lessons')
    .select('id,start_time')
    .eq('student_id', studentId)
    .lt('start_time', beforeISO)
    .neq('status', 'Cancelled')
    .order('start_time', { ascending: false })
    .limit(6);
  if (error) throw error;
  const rows = lessons || [];
  if (rows.length === 0) return null;
  const { data: notes, error: nErr } = await supabase
    .from('instructor_lesson_notes')
    .select('lesson_id,answers')
    .in('lesson_id', rows.map((l: any) => l.id));
  if (nErr) {
    if (isMissingLessonNotesTable(nErr.message || '')) return null;
    throw nErr;
  }
  const byLesson = new Map((notes || []).map((n: any) => [n.lesson_id, n.answers || {}]));
  for (const l of rows as any[]) {
    const answers = byLesson.get(l.id);
    if (!answers) continue;
    const f = pickFocus(questions, answers);
    if (f.practice || f.goal) return { lessonDate: l.start_time, ...f };
  }
  return null;
}

export async function listLessonNotesForStudent(studentId: string): Promise<InstructorLessonNote[]> {
  const { data, error } = await supabase
    .from('instructor_lesson_notes')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingLessonNotesTable(error.message || '')) return [];
    throw error;
  }
  return (data || []) as InstructorLessonNote[];
}

// Upsert — one row per lesson (unique constraint on lesson_id), so saving
// twice just updates the same entry rather than creating a duplicate.
export async function saveLessonNotes(input: {
  lessonId: string;
  studentId: string;
  instructorId: string;
  answers: Record<string, string>;
}): Promise<void> {
  const { error } = await supabase
    .from('instructor_lesson_notes')
    .upsert(
      {
        lesson_id: input.lessonId,
        student_id: input.studentId,
        instructor_id: input.instructorId,
        answers: input.answers,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'lesson_id' },
    );
  if (error) throw error;
}

// ===========================================================================
// ADI Standards Check tracking (Migration 030) — the instructor's own
// periodic DVSA quality assurance assessment. Distinct from student
// pass-rate stats.
// ===========================================================================

export type AdiStandardsCheck = {
  id: string;
  instructor_id: string;
  check_date: string;
  overall_score: number;
  risk_management_score: number | null;
  notes: string | null;
  created_at: string;
};

export type AdiGrade = 'A' | 'B' | 'Fail';

// Official DVSA boundaries: A 43-51, B 31-42, Fail 0-30.
export function computeAdiGrade(overallScore: number): AdiGrade {
  if (overallScore >= 43) return 'A';
  if (overallScore >= 31) return 'B';
  return 'Fail';
}

function isMissingAdiStandardsChecksTable(msg: string): boolean {
  return /adi_standards_checks/i.test(msg) && /(does not exist|schema cache)/i.test(msg);
}

export async function listMyStandardsChecks(instructorId: string): Promise<AdiStandardsCheck[]> {
  const { data, error } = await supabase
    .from('adi_standards_checks')
    .select('*')
    .eq('instructor_id', instructorId)
    .order('check_date', { ascending: false });
  if (error) {
    if (isMissingAdiStandardsChecksTable(error.message || '')) return [];
    throw error;
  }
  return (data || []) as AdiStandardsCheck[];
}

export async function addStandardsCheck(input: {
  instructorId: string;
  checkDate: string;
  overallScore: number;
  riskManagementScore?: number | null;
  notes?: string | null;
}): Promise<AdiStandardsCheck> {
  const { data, error } = await supabase
    .from('adi_standards_checks')
    .insert({
      instructor_id: input.instructorId,
      check_date: input.checkDate,
      overall_score: input.overallScore,
      risk_management_score: input.riskManagementScore ?? null,
      notes: input.notes?.trim() || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as AdiStandardsCheck;
}

export async function removeStandardsCheck(id: string): Promise<void> {
  const { error } = await supabase.from('adi_standards_checks').delete().eq('id', id);
  if (error) throw error;
}

// ===========================================================================
// Instructor deadlines (Migration 046) — ADI badge, MOT, insurance, road tax,
// dual-control service, custom items, plus the standards check worked out from
// the log above. Reminders are sent by backend/admin_reminders.py. RLS scopes
// every query to the signed-in instructor, so nothing here filters by school.
// ===========================================================================

export type { DeadlineItem } from './deadlines';

function isMissingDeadlinesRelation(msg: string): boolean {
  return /instructor_deadline(s|_items)/i.test(msg) && /(does not exist|schema cache)/i.test(msg);
}

/** Every deadline for the signed-in instructor, including the derived
 *  standards check, soonest first. */
export async function listMyDeadlineItems(): Promise<DeadlineItem[]> {
  const { data, error } = await supabase
    .from('instructor_deadline_items')
    .select('item_key,id,instructor_id,kind,label,due_date,notes,derived')
    .order('due_date', { ascending: true });
  if (error) {
    if (isMissingDeadlinesRelation(error.message || '')) return [];
    throw error;
  }
  return (data || []) as DeadlineItem[];
}

export async function addDeadline(input: {
  instructorId: string;
  kind: EditableDeadlineKind;
  dueDate: string;
  label?: string | null;
  notes?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('instructor_deadlines').insert({
    instructor_id: input.instructorId,
    kind: input.kind,
    due_date: input.dueDate,
    label: input.label?.trim() || null,
    notes: input.notes?.trim() || null,
  });
  if (error) {
    // The unique index allows one row per standard kind per instructor.
    if ((error as any).code === '23505') throw new Error('You are already tracking that. Edit it instead of adding it again.');
    throw error;
  }
}

/** Change a deadline's date (the usual "I've renewed it" action), name or notes. */
export async function updateDeadline(
  id: string,
  patch: { dueDate?: string; label?: string | null; notes?: string | null },
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.dueDate !== undefined) update.due_date = patch.dueDate;
  if (patch.label !== undefined) update.label = patch.label?.trim() || null;
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null;
  const { error } = await supabase.from('instructor_deadlines').update(update).eq('id', id);
  if (error) throw error;
}

export async function removeDeadline(id: string): Promise<void> {
  const { error } = await supabase.from('instructor_deadlines').delete().eq('id', id);
  if (error) throw error;
}

// ===========================================================================
// Setup checklist signals (28 Sept 2026) — two small lookups the new-instructor
// checklist needs that nothing else exposed. See setupChecklist.ts.
// ===========================================================================

/** When the signed-in instructor's account was created (ISO), or null. */
export async function getMyInstructorCreatedAt(): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('instructors')
    .select('created_at')
    .eq('auth_user_id', uid)
    .maybeSingle();
  if (error) throw error;
  return (data as { created_at?: string } | null)?.created_at ?? null;
}

/** True if this instructor has at least one lesson, of any status. Filters by
 *  instructor explicitly (RLS alone would let a school owner see the whole
 *  school's lessons, which would wrongly tick "book your first lesson"). */
export async function hasAnyLesson(instructorId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('lessons')
    .select('id', { count: 'exact', head: true })
    .eq('instructor_id', instructorId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// Lesson reminder read-receipt status (9 Sept 2026) — per Grant directly,
// referencing a competitor app's traffic-light system (MyDrive Time).
// Scoped to lesson reminders, per Grant's direct answer.
export type LessonReminderStatus = {
  status: 'sent' | 'delivered' | 'read' | 'failed';
  kind: 'h48' | 'h25' | 'h1';
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  /** How it went out (Migration 045). Email has no delivery/read receipts, so
   *  an emailed reminder stays 'sent' for good — the UI must not present that
   *  as "not yet delivered". Absent on a schema that hasn't got the column. */
  channel?: 'push' | 'email';
};

/** Most recently sent reminder for a lesson (a lesson can have up to
 * three — 48h/25h/1h — the newest one is the most relevant to show, since
 * it reflects whatever the student's most recently seen or not seen). */
export async function getLatestReminderStatus(lessonId: string): Promise<LessonReminderStatus | null> {
  const { data, error } = await supabase
    .from('lesson_reminder_log')
    .select('status,kind,sent_at,delivered_at,read_at,channel')
    .eq('lesson_id', lessonId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null; // table/columns may not exist yet on an older schema — fail soft, not fatal
  return (data as LessonReminderStatus) || null;
}




// =============================================================================
// GIFT VOUCHERS (Migration 049)
// =============================================================================
// A voucher is for a number of prepaid driving hours. The database generates
// the code and only lets an instructor see and change their own. "Expired" is
// not stored; see voucherStatus() in voucher.ts.

export type GiftVoucherStatus = 'active' | 'redeemed' | 'cancelled';

export type GiftVoucher = {
  id: string;
  school_id: string;
  instructor_id: string;
  code: string;
  hours: number;
  recipient_name: string | null;
  message: string | null;
  issued_at: string;
  /** YYYY-MM-DD */
  expires_at: string;
  status: GiftVoucherStatus;
  redeemed_at: string | null;
  /** Who redeemed it in the app (null if the instructor marked it redeemed by hand). */
  redeemed_by_name?: string | null;
};

const VOUCHER_COLUMNS =
  'id, school_id, instructor_id, code, hours, recipient_name, message, issued_at, expires_at, status, redeemed_at, ' +
  'redeemed_by:students!gift_vouchers_redeemed_by_student_id_fkey(full_name)';

function voucherFromRow(r: any): GiftVoucher {
  return {
    id: r.id,
    school_id: r.school_id,
    instructor_id: r.instructor_id,
    code: r.code,
    hours: Number(r.hours),
    recipient_name: r.recipient_name ?? null,
    message: r.message ?? null,
    issued_at: r.issued_at,
    expires_at: r.expires_at,
    status: r.status as GiftVoucherStatus,
    redeemed_at: r.redeemed_at ?? null,
    redeemed_by_name: r.redeemed_by?.full_name ?? null,
  };
}

/**
 * A pupil redeems a voucher by its code. The database does it all in one step (checks the code,
 * adds the hours to the pupil's wallet, marks the voucher used) so a code can never be used twice
 * (migration 069). The error messages it raises are written for the pupil to read.
 */
export async function redeemGiftVoucher(code: string): Promise<{ hours: number; balance: number }> {
  const { data, error } = await supabase.rpc('redeem_gift_voucher', { p_code: code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Could not redeem the voucher. Please try again.');
  return { hours: Number(row.voucher_hours), balance: Number(row.new_balance) };
}

/** Newest first. Row security limits this to the caller's own vouchers (a school owner also sees the school's). */
export async function listGiftVouchers(): Promise<GiftVoucher[]> {
  const { data, error } = await supabase
    .from('gift_vouchers')
    .select(VOUCHER_COLUMNS)
    .order('issued_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(voucherFromRow);
}

/** The code is generated by the database and comes back on the returned row. */
export async function createGiftVoucher(input: {
  instructorId: string;
  schoolId: string;
  hours: number;
  expiresAt: string;
  recipientName?: string | null;
  message?: string | null;
}): Promise<GiftVoucher> {
  const { data, error } = await supabase
    .from('gift_vouchers')
    .insert({
      instructor_id: input.instructorId,
      school_id: input.schoolId,
      hours: input.hours,
      expires_at: input.expiresAt,
      recipient_name: input.recipientName?.trim() || null,
      message: input.message?.trim() || null,
    })
    .select(VOUCHER_COLUMNS)
    .single();
  if (error) throw error;
  return voucherFromRow(data);
}

export async function setGiftVoucherStatus(id: string, status: GiftVoucherStatus): Promise<void> {
  const { error } = await supabase
    .from('gift_vouchers')
    .update({ status, redeemed_at: status === 'redeemed' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Extra pickup places for a pupil (the main address stays on the student row).
// ---------------------------------------------------------------------------
export type StudentPlace = { id: string; student_id: string; label: string; address: string; postcode: string | null };

/** The pupil extra places. Pass no id to read the signed-in pupil own. */
export async function listStudentPlaces(studentId?: string): Promise<StudentPlace[]> {
  const { data, error } = await supabase.rpc('list_student_places', { p_student_id: studentId ?? null });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as StudentPlace[];
}

export async function saveStudentPlace(input: { label: string; address: string; postcode?: string | null; studentId?: string; id?: string }): Promise<StudentPlace> {
  const { data, error } = await supabase.rpc('save_student_place', {
    p_label: input.label, p_address: input.address, p_postcode: input.postcode ?? null,
    p_student_id: input.studentId ?? null, p_id: input.id ?? null,
  });
  if (error) throw error;
  return data as StudentPlace;
}

export async function deleteStudentPlace(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_student_place', { p_id: id });
  if (error) throw error;
}
