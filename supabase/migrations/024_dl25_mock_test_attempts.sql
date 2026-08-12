-- =============================================================================
-- Migration 024 — DL25 mock test attempts (student self-practice)
-- =============================================================================
-- dl25-mock-test-screen.tsx lets a STUDENT self-administer a practice DL25
-- and previously passed the result to dl25-report-screen via router params
-- only — nothing was ever saved, so a student's practice history vanished
-- the moment they left the report screen.
--
-- This is intentionally a SEPARATE table from `test_outcomes` (Migration
-- 015). test_outcomes records REAL DVSA test bookings entered by the
-- instructor and feeds the school's official pass-rate KPI — mixing
-- self-administered practice attempts into it would silently corrupt that
-- business metric. mock_test_attempts is student-owned practice data only.
-- =============================================================================

create table if not exists public.mock_test_attempts (
    id                  uuid primary key default gen_random_uuid(),
    student_id          uuid not null references public.students(id) on delete cascade,
    taken_at            timestamptz not null default now(),
    driving_faults      integer not null default 0 check (driving_faults >= 0),
    serious_faults      integer not null default 0 check (serious_faults >= 0),
    dangerous_faults    integer not null default 0 check (dangerous_faults >= 0),
    passed              boolean not null,
    -- Per-category fault counts, e.g. {"junctions": {"driving": 1, "serious": 0, "dangerous": 0}, ...}
    category_breakdown  jsonb not null default '{}'::jsonb,
    created_at          timestamptz not null default now()
);

create index if not exists idx_mock_test_attempts_student_date
    on public.mock_test_attempts (student_id, taken_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.mock_test_attempts enable row level security;

-- Student reads and creates their own practice attempts.
drop policy if exists mock_test_attempts_self_read on public.mock_test_attempts;
create policy mock_test_attempts_self_read on public.mock_test_attempts
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = mock_test_attempts.student_id
              and s.auth_user_id = auth.uid()
        )
    );

drop policy if exists mock_test_attempts_self_insert on public.mock_test_attempts;
create policy mock_test_attempts_self_insert on public.mock_test_attempts
    for insert
    with check (
        exists (
            select 1 from public.students s
            where s.id = mock_test_attempts.student_id
              and s.auth_user_id = auth.uid()
        )
    );

-- Instructor reads practice history for their own assigned students (coaching visibility).
drop policy if exists mock_test_attempts_instructor_read on public.mock_test_attempts;
create policy mock_test_attempts_instructor_read on public.mock_test_attempts
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = mock_test_attempts.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    );

-- School owner reads practice history for every student in their school.
drop policy if exists mock_test_attempts_owner_read on public.mock_test_attempts;
create policy mock_test_attempts_owner_read on public.mock_test_attempts
    for select
    using (
        exists (
            select 1 from public.students s
            where s.id = mock_test_attempts.student_id
              and public.is_school_owner(s.school_id)
        )
    );

-- =============================================================================
-- DONE.
-- =============================================================================
