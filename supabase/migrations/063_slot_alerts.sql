-- Slot alerts: when an instructor's lesson is cancelled, pupils of that instructor who have
-- "Slot alerts" switched on get a push notification about the free slot.
--
--  - students.slot_alerts: the pupil's choice (on by default, as the screen always showed).
--    A pupil changes it through set_my_slot_alerts(); pupils cannot update students directly.
--  - lessons.slot_alert_sent_at: set when the backend has handled a cancelled lesson, so one
--    cancellation is only ever announced once.
--  - slot_alert_log: who was told about which slot, so one pupil is never told twice about the
--    same lesson and never flooded (the backend allows a few a week). Only the backend, with the
--    service key, reads or writes it: RLS is on with no policies.
alter table public.students add column if not exists slot_alerts boolean not null default true;
alter table public.lessons add column if not exists slot_alert_sent_at timestamptz;

create table if not exists public.slot_alert_log (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  sent_at     timestamptz not null default now(),
  push_count  integer not null default 0,
  unique (student_id, lesson_id)
);
create index if not exists idx_slot_alert_log_student_time on public.slot_alert_log(student_id, sent_at desc);
alter table public.slot_alert_log enable row level security;

create or replace function public.set_my_slot_alerts(p_on boolean) returns boolean
  language plpgsql security definer set search_path = public, pg_temp
as $f$
declare res boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_on is null then raise exception 'Choose on or off' using errcode = '22023'; end if;
  update public.students set slot_alerts = p_on where auth_user_id = auth.uid() returning slot_alerts into res;
  if not found then raise exception 'No student record is linked to this login' using errcode = 'P0002'; end if;
  return res;
end $f$;
revoke execute on function public.set_my_slot_alerts(boolean) from public, anon;
grant execute on function public.set_my_slot_alerts(boolean) to authenticated, service_role;
