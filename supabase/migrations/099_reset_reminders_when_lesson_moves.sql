-- ============================================================================
-- Migration 099 — A lesson that is moved gets its reminders again
-- ============================================================================
-- lesson_reminder_log remembers which reminders (48 hours, 25 hours, 1 hour before) have been sent for a lesson, so
-- none is sent twice. When a teacher moves a lesson to a new date or time, those memories are about the OLD time: a
-- reminder already sent would never be sent again for the new time, and the pupil would be left with the old time.
-- This clears the lesson's reminder log whenever its start_time changes. The reminders are sent only when a lesson is
-- close to a reminder time (a narrow window), so a lesson moved to a time where a reminder is already past does not
-- get a late one; each reminder that is still ahead goes out at the right time for the new start.
--
-- security definer: the log is written by the server, not by the teacher who moves the lesson, and must be cleared
-- whoever makes the move. The function is a trigger only; nobody can call it directly.
--
-- Additive and idempotent. Safe to apply before the code that moves lessons.
-- ============================================================================

create or replace function public.reset_lesson_reminders_on_move()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.start_time is distinct from old.start_time then
        delete from public.lesson_reminder_log where lesson_id = new.id;
    end if;
    return new;
end;
$$;

revoke execute on function public.reset_lesson_reminders_on_move() from public, anon, authenticated;

drop trigger if exists trg_lessons_reset_reminders on public.lessons;
create trigger trg_lessons_reset_reminders
    after update of start_time on public.lessons
    for each row execute function public.reset_lesson_reminders_on_move();
