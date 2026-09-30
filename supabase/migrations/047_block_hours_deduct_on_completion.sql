-- ============================================================================
-- Migration 047 — Deduct prepaid block hours when a lesson is completed
-- ============================================================================
-- Until now block_bookings.hours_used stayed at 0 forever: nothing in the app,
-- backend or database ever increased it, so a student's "hours left" always
-- equalled the hours bought, however many lessons they'd had.
--
-- Rule (agreed with Grant, 30 Sept 2026): hours are deducted when a lesson is
-- marked Completed, taking from the student's OLDEST block first, and given
-- back if the lesson stops being Completed (un-completed, cancelled, deleted)
-- or its length changes. It is done in the database so it holds from any
-- screen or device.
--
--   - Only hours are touched. Money is unchanged: the arrears view
--     (students_with_balance, Migration 022) already counts each block's
--     amount once as a credit and never looks at hours, so nothing is double
--     counted.
--   - Not retroactive: a block bought after a lesson was completed does not
--     pay for that lesson. Hours are only ever taken at completion.
--   - If the student's blocks don't cover the whole lesson, the hours that ARE
--     available are used and the rest simply isn't prepaid.
--   - A completed lesson is never charged twice (usage is recorded per
--     lesson), and repeating the same update is a no-op.
--
-- Usage rows are kept in block_booking_usage so a lesson's hours can be
-- returned to the exact blocks they came from. The table is internal: RLS is
-- on with no policies, so only the trigger function (SECURITY DEFINER) touches
-- it, the same locked-down pattern as deadline_reminder_log (Migration 046).
--
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.block_booking_usage (
    lesson_id        uuid not null references public.lessons(id) on delete cascade,
    block_booking_id uuid not null references public.block_bookings(id) on delete cascade,
    hours            numeric(5,2) not null check (hours > 0),
    created_at       timestamptz not null default now(),
    primary key (lesson_id, block_booking_id)
);

create index if not exists idx_block_booking_usage_block on public.block_booking_usage(block_booking_id);

alter table public.block_booking_usage enable row level security;

comment on table public.block_booking_usage is
    'Which block(s) each completed lesson drew hours from, so they can be returned exactly. '
    'Internal: written only by sync_block_hours_for_lesson(); no client policies.';

-- ---------------------------------------------------------------------------
-- The trigger function
-- ---------------------------------------------------------------------------
create or replace function public.sync_block_hours_for_lesson()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_needed  numeric(7,2);
    v_have    numeric(7,2);
    v_take    numeric(7,2);
    b         record;
    u         record;
begin
    -- Lesson deleted: give its hours back (usage rows go with it afterwards).
    if tg_op = 'DELETE' then
        for u in select block_booking_id, hours from public.block_booking_usage where lesson_id = old.id loop
            update public.block_bookings
               set hours_used = greatest(0, hours_used - u.hours)
             where id = u.block_booking_id;
        end loop;
        delete from public.block_booking_usage where lesson_id = old.id;
        return old;
    end if;

    if new.status = 'Completed' then
        v_needed := round(
            coalesce(new.duration_hours,
                     extract(epoch from (new.end_time - new.start_time)) / 3600.0,
                     0)::numeric, 2);

        select coalesce(sum(hours), 0) into v_have
          from public.block_booking_usage where lesson_id = new.id;

        -- Already deducted for exactly this length: nothing to do.
        if v_have > 0 and v_have = v_needed then
            return new;
        end if;

        -- Length changed since it was deducted: put it back, then redo it.
        if v_have > 0 then
            for u in select block_booking_id, hours from public.block_booking_usage where lesson_id = new.id loop
                update public.block_bookings
                   set hours_used = greatest(0, hours_used - u.hours)
                 where id = u.block_booking_id;
            end loop;
            delete from public.block_booking_usage where lesson_id = new.id;
        end if;

        if v_needed <= 0 or new.student_id is null then
            return new;
        end if;

        -- Oldest block first; lock the rows so two lessons completed at once
        -- can't both spend the same hours.
        for b in
            select id, (hours_paid - hours_used) as remaining
              from public.block_bookings
             where student_id = new.student_id
               and hours_paid - hours_used > 0
             order by purchased_at, created_at, id
               for update
        loop
            exit when v_needed <= 0;
            v_take := least(v_needed, b.remaining);
            update public.block_bookings set hours_used = hours_used + v_take where id = b.id;
            insert into public.block_booking_usage (lesson_id, block_booking_id, hours)
                 values (new.id, b.id, v_take);
            v_needed := v_needed - v_take;
        end loop;

    elsif tg_op = 'UPDATE' and old.status = 'Completed' then
        -- No longer Completed (un-completed, or cancelled): give the hours back.
        for u in select block_booking_id, hours from public.block_booking_usage where lesson_id = new.id loop
            update public.block_bookings
               set hours_used = greatest(0, hours_used - u.hours)
             where id = u.block_booking_id;
        end loop;
        delete from public.block_booking_usage where lesson_id = new.id;
    end if;

    return new;
end;
$$;

-- Trigger functions run at the trigger's say-so, not a caller's EXECUTE
-- privilege, so nobody should be able to call this one directly (same as the
-- other trigger functions locked down in Migration 044).
revoke all on function public.sync_block_hours_for_lesson() from public, anon, authenticated;

drop trigger if exists trg_lessons_block_hours on public.lessons;
create trigger trg_lessons_block_hours
    after insert or update of status, duration_hours, start_time, end_time on public.lessons
    for each row execute function public.sync_block_hours_for_lesson();

-- BEFORE delete so the hours are returned before the usage rows cascade away.
drop trigger if exists trg_lessons_block_hours_release on public.lessons;
create trigger trg_lessons_block_hours_release
    before delete on public.lessons
    for each row execute function public.sync_block_hours_for_lesson();

-- ============================================================================
-- DONE.
-- ============================================================================
