-- =============================================================================
-- Migration 004 — Link students to Supabase Auth users
-- =============================================================================
-- Purpose:
--   Adds an `auth_user_id` column on `public.students` so that when an
--   instructor sends a Supabase Auth invite to a learner, the resulting
--   auth user can later be matched back to their student row by uid.
--
--   This unblocks the student-facing app (student-home-screen) from
--   resolving "who am I?" reliably, instead of relying on email matching.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- 1. Add the column (nullable — older students may have no auth account yet).
alter table public.students
    add column if not exists auth_user_id uuid
        references auth.users(id) on delete set null;

-- Unique partial index — at most one student row may claim any given auth uid.
create unique index if not exists ux_students_auth_user_id
    on public.students(auth_user_id)
    where auth_user_id is not null;

-- Fast lookup for the student-side app.
create index if not exists idx_students_auth_user_id
    on public.students(auth_user_id);

-- =============================================================================
-- 2. Student-side RLS policies
-- =============================================================================
-- A signed-in learner whose auth.uid() matches students.auth_user_id should
-- be able to read their own row + their related child rows. Writes remain
-- restricted to the instructor / school owner (existing policies handle that).
-- =============================================================================

drop policy if exists students_self_read on public.students;

create policy students_self_read on public.students
    for select
    using (auth.uid() = auth_user_id);

-- Lessons -- the learner can see their own lessons.
drop policy if exists lessons_self_read on public.lessons;

create policy lessons_self_read on public.lessons
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = lessons.student_id
              and s.auth_user_id = auth.uid()
        )
    );

-- DVSA syllabus tracking -- learner reads their own progress.
drop policy if exists dvsa_self_read on public.dvsa_syllabus_tracking;

create policy dvsa_self_read on public.dvsa_syllabus_tracking
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = dvsa_syllabus_tracking.student_id
              and s.auth_user_id = auth.uid()
        )
    );

-- Reflective logs -- learner reads and writes their own reflections.
drop policy if exists reflective_logs_self_read   on public.reflective_logs;
drop policy if exists reflective_logs_self_insert on public.reflective_logs;

create policy reflective_logs_self_read on public.reflective_logs
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = reflective_logs.student_id
              and s.auth_user_id = auth.uid()
        )
    );

create policy reflective_logs_self_insert on public.reflective_logs
    for insert
    with check (
        exists (
            select 1 from public.students s
            where s.id = reflective_logs.student_id
              and s.auth_user_id = auth.uid()
        )
    );

-- Block bookings -- learner reads their own wallet/bookings (no insert: that
-- happens via Stripe webhook on the backend with the service role key).
drop policy if exists block_bookings_self_read on public.block_bookings;

create policy block_bookings_self_read on public.block_bookings
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = block_bookings.student_id
              and s.auth_user_id = auth.uid()
        )
    );

-- Badges earned -- learner reads their own ribbons.
drop policy if exists badges_earned_self_read on public.badges_earned;

create policy badges_earned_self_read on public.badges_earned
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = badges_earned.student_id
              and s.auth_user_id = auth.uid()
        )
    );

-- =============================================================================
-- 3. Best-effort backfill — link any existing student whose email already
--    matches a confirmed auth.users row.
-- =============================================================================
update public.students s
   set auth_user_id = u.id
  from auth.users u
 where s.auth_user_id is null
   and lower(u.email) = lower(s.email);

-- =============================================================================
-- 4. Helper: link a learner to their auth row by email (called by backend
--    when an invite acceptance webhook fires).
-- =============================================================================
create or replace function public.link_student_to_auth(p_email text, p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.students
       set auth_user_id = p_uid
     where lower(email) = lower(p_email)
       and auth_user_id is null;
end;
$$;

grant execute on function public.link_student_to_auth(text, uuid) to anon, authenticated, service_role;

-- =============================================================================
-- DONE.
-- =============================================================================
