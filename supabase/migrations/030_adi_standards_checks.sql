-- =============================================================================
-- Migration 030 — Instructor's own DVSA Standards Check tracking
-- =============================================================================
-- Distinct from student pass-rate stats (test_outcomes, Migration 002-ish) —
-- this is the instructor's OWN periodic quality assurance assessment. DVSA
-- re-checks every registered ADI at least once every 4 years: an examiner
-- observes a real lesson and scores 17 competencies (grouped into lesson
-- planning / risk management / teaching & learning), 0-3 each, out of a
-- possible 51 points total. Grades: A (43-51), B (31-42), Fail (0-30) — with
-- an automatic fail if the Risk Management category alone scores 7 or under,
-- regardless of the overall total.
--
-- Deliberately not tracking all 17 individual competency scores — that
-- level of granularity isn't something an instructor would realistically
-- re-enter for a once-every-4-years event, and DVSA's own exact per-category
-- maximums aren't something to guess at. Overall score + the one
-- well-documented special threshold (risk management) is the right level
-- of detail for a real, usable log.
-- =============================================================================

create table if not exists public.adi_standards_checks (
    id                    uuid primary key default gen_random_uuid(),
    instructor_id         uuid not null references public.instructors(id) on delete cascade,
    check_date            date not null,
    overall_score         integer not null check (overall_score between 0 and 51),
    risk_management_score integer check (risk_management_score between 0 and 3 * 6), -- generous upper bound; DVSA's exact per-category max isn't publicly fixed enough to hard-code tighter
    notes                 text,
    created_at            timestamptz not null default now()
);

create index if not exists idx_adi_standards_checks_instructor
    on public.adi_standards_checks(instructor_id, check_date desc);

alter table public.adi_standards_checks enable row level security;

drop policy if exists adi_standards_checks_owner on public.adi_standards_checks;
create policy adi_standards_checks_owner on public.adi_standards_checks
    for all
    using (instructor_id = public.current_user_instructor_id())
    with check (instructor_id = public.current_user_instructor_id());

-- School owner: read-only visibility across their school (consistent with
-- other instructor-level records the owner can already see).
drop policy if exists adi_standards_checks_owner_read on public.adi_standards_checks;
create policy adi_standards_checks_owner_read on public.adi_standards_checks
    for select
    using (
        exists (
            select 1 from public.instructors i
            where i.id = adi_standards_checks.instructor_id
              and public.is_school_owner(i.school_id)
        )
    );

-- =============================================================================
-- DONE.
-- =============================================================================
