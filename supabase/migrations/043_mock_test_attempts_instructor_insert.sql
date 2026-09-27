-- =============================================================================
-- Migration 043 — Let an instructor/owner record a mock test for their student
-- =============================================================================
-- Adds a "Start mock test" entry point on student-lifecycle-screen so an
-- instructor can run and score a DL25 mock test live with a student, instead
-- of it only being something the student takes on themselves in the app.
--
-- mock_test_attempts had SELECT policies for the student's own instructor and
-- the school owner (mock_test_attempts_instructor_read / _owner_read), but the
-- only INSERT policy was mock_test_attempts_self_insert (the student's own
-- auth.uid()). An instructor calling addMockTestAttempt() for their student
-- would be rejected by RLS with no matching row — the attempt would silently
-- fail to save (the app catches the error and shows an alert, but the score
-- never appears in the student's history). This adds the missing INSERT
-- policies, mirroring the existing read policies' own conditions exactly.
--
-- Idempotent: safe to re-run.
-- =============================================================================

drop policy if exists mock_test_attempts_instructor_insert on public.mock_test_attempts;
create policy mock_test_attempts_instructor_insert on public.mock_test_attempts
    for insert
    with check (
        exists (
            select 1 from public.students s
            where s.id = mock_test_attempts.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    );

drop policy if exists mock_test_attempts_owner_insert on public.mock_test_attempts;
create policy mock_test_attempts_owner_insert on public.mock_test_attempts
    for insert
    with check (
        exists (
            select 1 from public.students s
            where s.id = mock_test_attempts.student_id
              and public.is_school_owner(s.school_id)
        )
    );

-- =============================================================================
-- DONE.
-- =============================================================================
