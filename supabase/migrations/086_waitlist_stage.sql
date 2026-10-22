-- ============================================================================
-- Migration 086 — Waiting-list pipeline: a stage inside the Waitlist status
-- ============================================================================
-- A pupil on the waiting list is at one of three stages: Waiting (enquiry, not
-- yet spoken to), Contacted (the instructor has been in touch) or Booked (a
-- first lesson is arranged). "Started" is not stored: it is simply the pupil
-- becoming Active.
--
--   waitlist_stage     'Waiting' | 'Contacted' | 'Booked'; null unless status = 'Waitlist'
--   waitlist_stage_at  when the pupil reached that stage (drives "waiting 7+ days")
--
-- Kept in step by a trigger, so the app and every other writer behave the same:
--   - becoming Waitlist with no stage  -> 'Waiting'
--   - the stage changing               -> waitlist_stage_at = now()
--   - leaving Waitlist                 -> stage cleared
-- Existing Waitlist pupils become 'Waiting', timed from when they were added.
--
-- RLS: unchanged (the existing student policies already cover these columns).
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.students add column if not exists waitlist_stage text;
alter table public.students add column if not exists waitlist_stage_at timestamptz;

do $$ begin
    alter table public.students drop constraint if exists students_waitlist_stage_chk;
    alter table public.students
        add constraint students_waitlist_stage_chk
        check (waitlist_stage is null or waitlist_stage in ('Waiting', 'Contacted', 'Booked'));
end $$;

create or replace function public.students_waitlist_stage_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.status = 'Waitlist' then
        if new.waitlist_stage is null then
            new.waitlist_stage := 'Waiting';
        end if;
        if tg_op = 'INSERT'
           or old.status is distinct from 'Waitlist'
           or old.waitlist_stage is distinct from new.waitlist_stage
           or new.waitlist_stage_at is null then
            new.waitlist_stage_at := now();
        end if;
    else
        new.waitlist_stage := null;
        new.waitlist_stage_at := null;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_students_waitlist_stage on public.students;
create trigger trg_students_waitlist_stage
    before insert or update on public.students
    for each row execute function public.students_waitlist_stage_sync();

-- Backfill: existing waiting-list pupils start at 'Waiting', timed from when they joined.
update public.students
set waitlist_stage = 'Waiting',
    waitlist_stage_at = coalesce(created_at, now())
where status = 'Waitlist' and waitlist_stage is null;
