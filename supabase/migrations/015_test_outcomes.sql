-- =============================================================================
-- Migration 015 — Driving / Theory test outcomes
-- =============================================================================
-- Stores individual DVSA test attempts for each student. Powers both the
-- per-student history on the student profile and the aggregated "Pass rate"
-- KPI on the instructor dashboard.
--
-- One row per test attempt. A student who fails twice and then passes will
-- therefore have three rows; the "result" of the LATEST row is what counts
-- toward overall pass-rate, but individual attempts remain queryable for the
-- DVSA two-change tracker (Future Tasks/P2).
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.test_outcomes (
    id                  uuid primary key default gen_random_uuid(),
    instructor_id       uuid not null references public.instructors(id)   on delete cascade,
    school_id           uuid          references public.driving_schools(id) on delete set null,
    student_id          uuid not null references public.students(id)      on delete cascade,
    test_type           text not null check (test_type in ('theory', 'practical')),
    test_date           date not null,
    result              text not null check (result in ('pass', 'fail')),

    -- ---- Practical-only metrics --------------------------------------------
    driving_faults      integer check (driving_faults  is null or driving_faults  >= 0),
    serious_faults      integer check (serious_faults  is null or serious_faults  >= 0),
    dangerous_faults    integer check (dangerous_faults is null or dangerous_faults >= 0),

    -- ---- Theory-only metrics -----------------------------------------------
    -- DVSA theory: 50 multiple-choice questions + 14-clip hazard perception (out of 75).
    theory_mc_score     integer check (theory_mc_score is null or (theory_mc_score between 0 and 50)),
    theory_hp_score     integer check (theory_hp_score is null or (theory_hp_score between 0 and 75)),

    -- ---- Both --------------------------------------------------------------
    test_centre         text,
    examiner_notes      text,
    -- Multi-select preset chips for common DVSA mark-sheet fault categories.
    retest_reasons      text[] not null default '{}'::text[],

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists idx_test_outcomes_instructor_date
    on public.test_outcomes (instructor_id, test_date desc);

create index if not exists idx_test_outcomes_student_date
    on public.test_outcomes (student_id, test_date desc);

-- Re-use the touch-updated_at trigger function from Migration 013.
do $$
begin
    if not exists (select 1 from pg_proc where proname = 'set_updated_at_timestamp') then
        create or replace function public.set_updated_at_timestamp()
        returns trigger as $body$
        begin new.updated_at = now(); return new; end;
        $body$ language plpgsql;
    end if;
end$$;

drop trigger if exists trg_test_outcomes_updated_at on public.test_outcomes;
create trigger trg_test_outcomes_updated_at
    before update on public.test_outcomes
    for each row execute function public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.test_outcomes enable row level security;

-- Instructors manage (read/write/delete) outcomes for THEIR students.
drop policy if exists "test_outcomes_instructor_self" on public.test_outcomes;
create policy "test_outcomes_instructor_self"
    on public.test_outcomes
    for all
    using (
        instructor_id in (
            select id from public.instructors where auth_user_id = auth.uid()
        )
    )
    with check (
        instructor_id in (
            select id from public.instructors where auth_user_id = auth.uid()
        )
    );

-- Owners can read all test outcomes for instructors in their school.
drop policy if exists "test_outcomes_owner_read" on public.test_outcomes;
create policy "test_outcomes_owner_read"
    on public.test_outcomes
    for select
    using (
        school_id in (
            select id from public.driving_schools where owner_auth_id = auth.uid()
        )
    );

-- Students can read THEIR OWN outcomes (so the student app can show their
-- test history without leaking other students' data).
drop policy if exists "test_outcomes_student_self_read" on public.test_outcomes;
create policy "test_outcomes_student_self_read"
    on public.test_outcomes
    for select
    using (
        student_id in (
            select id from public.students where auth_user_id = auth.uid()
        )
    );

-- =============================================================================
-- DONE.
-- =============================================================================
