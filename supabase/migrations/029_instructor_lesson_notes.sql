-- =============================================================================
-- Migration 029 — Customizable instructor lesson notes
-- =============================================================================
-- A genuinely new, separate feature from the existing student-authored
-- `reflective_logs` (one free-text field, filled in by the student about
-- their own lesson). This is the instructor's own structured post-lesson
-- notes, using a question set the instructor defines themselves — matching
-- what a competitor app's "Notes Questions" screen does.
--
-- Two tables: the instructor's own ordered question list (shared across all
-- their lessons), and the actual answers given for one specific lesson.
-- =============================================================================

create table if not exists public.lesson_note_questions (
    id             uuid primary key default gen_random_uuid(),
    instructor_id  uuid not null references public.instructors(id) on delete cascade,
    question_text  text not null,
    sort_order     integer not null default 0,
    -- Soft-delete: hiding a question from future lessons must never delete
    -- historical answers already given against it.
    is_active      boolean not null default true,
    created_at     timestamptz not null default now()
);

create index if not exists idx_lesson_note_questions_instructor
    on public.lesson_note_questions(instructor_id, sort_order);

alter table public.lesson_note_questions enable row level security;

drop policy if exists lesson_note_questions_owner on public.lesson_note_questions;
create policy lesson_note_questions_owner on public.lesson_note_questions
    for all
    using (instructor_id = public.current_user_instructor_id())
    with check (instructor_id = public.current_user_instructor_id());


create table if not exists public.instructor_lesson_notes (
    id             uuid primary key default gen_random_uuid(),
    lesson_id      uuid not null references public.lessons(id) on delete cascade,
    student_id     uuid not null references public.students(id) on delete cascade,
    instructor_id  uuid not null references public.instructors(id) on delete cascade,
    -- {question_id: answer_text} — deliberately not one row per answer,
    -- since a lesson's notes are always read/written as a single unit and
    -- normalizing further would just mean an extra join for no real benefit.
    answers        jsonb not null default '{}'::jsonb,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint instructor_lesson_notes_one_per_lesson unique (lesson_id)
);

create index if not exists idx_instructor_lesson_notes_student
    on public.instructor_lesson_notes(student_id);

alter table public.instructor_lesson_notes enable row level security;

-- Instructor: full access to their own lessons' notes.
drop policy if exists instructor_lesson_notes_owner on public.instructor_lesson_notes;
create policy instructor_lesson_notes_owner on public.instructor_lesson_notes
    for all
    using (instructor_id = public.current_user_instructor_id())
    with check (instructor_id = public.current_user_instructor_id());

-- School owner: read-only across their whole school (consistent with how
-- owners can already see school-wide lesson/student data elsewhere).
drop policy if exists instructor_lesson_notes_owner_read on public.instructor_lesson_notes;
create policy instructor_lesson_notes_owner_read on public.instructor_lesson_notes
    for select
    using (
        exists (
            select 1 from public.instructors i
            where i.id = instructor_lesson_notes.instructor_id
              and public.is_school_owner(i.school_id)
        )
    );

-- =============================================================================
-- DONE.
-- =============================================================================
