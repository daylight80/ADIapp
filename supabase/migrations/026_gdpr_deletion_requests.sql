-- =============================================================================
-- Migration 026 — GDPR deletion requests
-- =============================================================================
-- The app's own Terms & Conditions promise "you may request your data or
-- its deletion at any time," but nothing in the app could actually record
-- or act on such a request. This adds a real audit trail: a data subject
-- (student or instructor) submits a request, it's timestamped and logged,
-- and whoever's responsible for acting on it can mark it resolved.
--
-- Deliberately NOT auto-executing deletion on submission — an irreversible
-- deletion of a real person's data should have a human confirm it (the
-- instructor already has a working hard-delete for students; this adds the
-- missing piece: a formal, student-initiated request feeding into it).
-- =============================================================================

create table if not exists public.gdpr_deletion_requests (
    id                  uuid primary key default gen_random_uuid(),
    requested_by_role   text not null check (requested_by_role in ('student', 'instructor')),
    requested_by_auth_id uuid not null,
    -- Exactly one of these is set, matching requested_by_role.
    student_id          uuid references public.students(id) on delete cascade,
    instructor_id       uuid references public.instructors(id) on delete cascade,
    reason              text,
    status              text not null default 'pending' check (status in ('pending', 'completed', 'declined')),
    requested_at        timestamptz not null default now(),
    resolved_at         timestamptz,
    resolved_by         uuid references public.instructors(id) on delete set null,
    resolution_note     text,
    constraint gdpr_request_subject_matches_role check (
        (requested_by_role = 'student' and student_id is not null and instructor_id is null)
        or
        (requested_by_role = 'instructor' and instructor_id is not null and student_id is null)
    )
);

create index if not exists idx_gdpr_requests_student on public.gdpr_deletion_requests(student_id);
create index if not exists idx_gdpr_requests_instructor on public.gdpr_deletion_requests(instructor_id);
create index if not exists idx_gdpr_requests_status on public.gdpr_deletion_requests(status);

alter table public.gdpr_deletion_requests enable row level security;

-- A student can submit and view their own requests.
drop policy if exists gdpr_student_insert_own on public.gdpr_deletion_requests;
create policy gdpr_student_insert_own on public.gdpr_deletion_requests
    for insert
    with check (
        requested_by_role = 'student'
        and exists (
            select 1 from public.students s
            where s.id = gdpr_deletion_requests.student_id
              and s.auth_user_id = auth.uid()
        )
    );

drop policy if exists gdpr_student_read_own on public.gdpr_deletion_requests;
create policy gdpr_student_read_own on public.gdpr_deletion_requests
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = gdpr_deletion_requests.student_id
              and s.auth_user_id = auth.uid()
        )
    );

-- An instructor can submit and view their own requests, and can view (and
-- resolve) requests submitted by their own assigned students.
drop policy if exists gdpr_instructor_insert_own on public.gdpr_deletion_requests;
create policy gdpr_instructor_insert_own on public.gdpr_deletion_requests
    for insert
    with check (
        requested_by_role = 'instructor'
        and instructor_id = public.current_user_instructor_id()
    );

drop policy if exists gdpr_instructor_read on public.gdpr_deletion_requests;
create policy gdpr_instructor_read on public.gdpr_deletion_requests
    for select
    using (
        instructor_id = public.current_user_instructor_id()
        or exists (
            select 1 from public.students s
            where s.id = gdpr_deletion_requests.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    );

drop policy if exists gdpr_instructor_resolve on public.gdpr_deletion_requests;
create policy gdpr_instructor_resolve on public.gdpr_deletion_requests
    for update
    using (
        exists (
            select 1 from public.students s
            where s.id = gdpr_deletion_requests.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    )
    with check (
        exists (
            select 1 from public.students s
            where s.id = gdpr_deletion_requests.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    );

-- School owner sees every request across their school (students of any of
-- their instructors, and their instructors' own requests).
drop policy if exists gdpr_owner_read on public.gdpr_deletion_requests;
create policy gdpr_owner_read on public.gdpr_deletion_requests
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = gdpr_deletion_requests.student_id
              and public.is_school_owner(s.school_id)
        )
        or exists (
            select 1 from public.instructors i
            where i.id = gdpr_deletion_requests.instructor_id
              and public.is_school_owner(i.school_id)
        )
    );

-- =============================================================================
-- DONE.
-- =============================================================================
