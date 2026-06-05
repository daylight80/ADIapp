-- ============================================================================
-- Migration 019 — Instructor notes on students
-- ============================================================================
-- Adds a free-text `notes` column to the `students` table so instructors can
-- record private observations about each learner (pace, focus areas, exam
-- readiness, etc.). This is surfaced in the "Instructor notes" card on the
-- Student Overview screen with a pencil-icon editor.
--
-- Privacy: this field inherits the existing RLS on `students` — only the
-- student's assigned instructor and the school owner can read or write it.
-- Students themselves cannot see these notes via the existing student-side
-- RLS policies.
-- ============================================================================

alter table public.students
    add column if not exists notes text;

-- A short comment surfaces the intent in pgAdmin / Supabase studio.
comment on column public.students.notes is
    'Private free-text notes the instructor records about this student. Visible only to the assigned instructor and the school owner.';
