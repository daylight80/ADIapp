-- ============================================================================
-- Migration 090 — Pre-lesson plan on a lesson
-- ============================================================================
-- The instructor plans a lesson from the syllabus: which topics, and a short briefing (where, what to expect).
-- During the lesson the planned topics are ticked off.
--
--   plan_topics   syllabus topic keys planned for the lesson (DVSA_SYLLABUS keys in the app), at most 20
--   plan_covered  the planned topics ticked off during the lesson
--   plan_brief    a short briefing or route note, at most 500 characters
--
-- Columns on lessons, so the existing row policies apply unchanged: the instructor and school owner edit them,
-- and the pupil sees their own lesson's plan the same way they see the rest of the lesson. Nothing private
-- goes in them (the instructor's private notes stay in instructor_lesson_notes).
-- Idempotent.
-- ============================================================================

alter table public.lessons add column if not exists plan_topics text[] not null default '{}';
alter table public.lessons add column if not exists plan_covered text[] not null default '{}';
alter table public.lessons add column if not exists plan_brief text;

do $$ begin
  alter table public.lessons drop constraint if exists lessons_plan_chk;
  alter table public.lessons add constraint lessons_plan_chk check (
    cardinality(plan_topics) <= 20 and cardinality(plan_covered) <= 20
    and (plan_brief is null or char_length(plan_brief) <= 500)
  );
end $$;
