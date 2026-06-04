-- ============================================================================
-- Migration 018 — Student lifecycle: Inactive & Waitlist statuses
-- ============================================================================
-- The existing `students.status` column (added in migration 002) accepts the
-- four pipeline values: 'New', 'Active', 'Test Ready', 'Passed'. This
-- migration extends the check constraint so instructors can also place a
-- student into 'Inactive' (paused — no upcoming lessons) or 'Waitlist'
-- (interested but not yet onboarded / no slot available).
--
-- Cascade DELETE on lessons, dvsa_syllabus_tracking, test_outcomes, packages,
-- wallet_ledger, waiting_list, and lesson_history was already set in earlier
-- migrations, so a DELETE on students will tidy up dependent rows
-- automatically — no FK constraint changes needed in this migration.
--
-- RLS: the existing policies (`stu_owner_all` and `stu_instructor_select` /
-- `stu_instructor_update`) already permit an instructor to UPDATE or DELETE
-- their own assigned student rows.
-- ============================================================================

do $$ begin
    alter table public.students drop constraint if exists students_status_chk;
end $$;

do $$ begin
    alter table public.students
        add constraint students_status_chk
        check (status in ('New', 'Active', 'Test Ready', 'Passed', 'Inactive', 'Waitlist'));
end $$;

-- Optional: backfill index to keep filter queries fast (already exists,
-- recreating defensively in case it was dropped during ad-hoc edits).
create index if not exists idx_students_status on public.students(status);
