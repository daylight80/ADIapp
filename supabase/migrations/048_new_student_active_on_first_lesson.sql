-- ============================================================================
-- Migration 048 — A New student becomes Active when a lesson is completed
-- ============================================================================
-- Nothing ever moved a student out of 'New'. The only route to 'Active' was the
-- Reactivate button, which is only shown for Inactive/Waitlist students, so a
-- newly added student stayed 'New' forever (a real account showed 0 Active
-- students with every student still New).
--
-- Rule (agreed with Grant, 30 Sept 2026): when a lesson becomes Completed for
-- a student whose status is 'New', they become 'Active'.
--
--   - Only 'New' is ever promoted. Inactive, Waitlist, Test Ready and Passed
--     students are never changed by a completed lesson.
--   - It happens when a lesson BECOMES Completed (inserted as Completed, or
--     status changed to Completed), not on every later edit of that lesson.
--   - Un-completing or deleting the lesson does not put them back to New: the
--     instructor can move them with the buttons on the student's profile.
--
-- This extends recount_student_lessons(), which already runs after every
-- lesson insert/delete/status change to keep students.lessons_count right, so
-- no new trigger is needed. Its security posture is unchanged (SECURITY
-- DEFINER, pinned search_path, EXECUTE revoked in Migration 044).
--
-- The backfill applies the same rule to students who are still 'New' but
-- already have a completed lesson.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create or replace function public.recount_student_lessons()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    sid uuid;
begin
    if tg_op = 'DELETE' then sid := old.student_id; else sid := new.student_id; end if;

    update public.students s
    set lessons_count = (
        select count(*) from public.lessons l
        where l.student_id = sid and l.status = 'Completed'
    )
    where s.id = sid;

    -- Kept as separate ifs: NEW is not assigned for DELETE, and plpgsql does
    -- not guarantee AND short-circuits, so it must not be read in the same test.
    if tg_op <> 'DELETE' then
        if new.status = 'Completed' and (tg_op = 'INSERT' or old.status is distinct from 'Completed') then
            update public.students set status = 'Active' where id = sid and status = 'New';
        end if;
    end if;

    return coalesce(new, old);
end;
$$;

-- CREATE OR REPLACE keeps existing grants, but state the intent explicitly.
revoke all on function public.recount_student_lessons() from public, anon, authenticated;

-- Backfill: students still 'New' who already have a completed lesson.
update public.students s
   set status = 'Active'
 where s.status = 'New'
   and exists (
       select 1 from public.lessons l
        where l.student_id = s.id and l.status = 'Completed'
   );

-- ============================================================================
-- DONE.
-- ============================================================================
