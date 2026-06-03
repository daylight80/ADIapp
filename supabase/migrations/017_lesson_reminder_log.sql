-- ============================================================================
-- Migration 017 — Lesson Reminder Log (anti-duplicate guard for push reminders)
-- ============================================================================
-- The backend scheduler dispatches push notifications to STUDENTS at three
-- intervals before a lesson: 48 hours, 25 hours, and 1 hour. Because the
-- scheduler runs every 5 minutes, we need a durable record of which
-- (lesson, reminder kind) pairs have already been sent so a server restart
-- or retried tick doesn't double-fire.
-- ============================================================================

create table if not exists public.lesson_reminder_log (
    id          uuid primary key default gen_random_uuid(),
    lesson_id   uuid not null references public.lessons(id) on delete cascade,
    kind        text not null check (kind in ('h48', 'h25', 'h1')),
    sent_at     timestamptz not null default now(),
    /* For debugging/analytics: number of tokens we fanned out to. */
    push_count  int not null default 0,
    unique (lesson_id, kind)
);

create index if not exists idx_lesson_reminder_log_lesson
    on public.lesson_reminder_log(lesson_id);

alter table public.lesson_reminder_log enable row level security;

-- The scheduler runs with the service-role key, which bypasses RLS by design.
-- Owners may want to see a history of dispatched reminders for their lessons,
-- so we grant read access through the lesson → instructor → school chain.
drop policy if exists lesson_reminder_log_select on public.lesson_reminder_log;
create policy lesson_reminder_log_select on public.lesson_reminder_log
    for select using (
        exists (
            select 1
            from public.lessons l
            join public.instructors i on i.id = l.instructor_id
            join public.driving_schools s on s.id = i.school_id
            where l.id = lesson_reminder_log.lesson_id
              and (s.owner_auth_id = auth.uid() or i.auth_user_id = auth.uid())
        )
    );

-- No INSERT/UPDATE/DELETE policies for normal users — the scheduler is the
-- only writer and it uses the service-role key. Cascade DELETE from lessons
-- takes care of cleanup when a lesson is deleted.
