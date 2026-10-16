-- An instructor's choice to mention a pupil's unpaid balance in the 24-hour lesson reminder (off by default). It is
-- read by the backend when it sends the reminder, and set from Profile through functions that only touch the
-- caller's own row (the instructors table can only be updated directly by a school owner).
alter table public.instructors add column if not exists mention_balance_in_reminders boolean not null default false;

create or replace function public.get_my_reminder_balance_setting() returns boolean language sql stable security definer set search_path = public, pg_temp
  as $f$ select coalesce((select i.mention_balance_in_reminders from public.instructors i where i.auth_user_id = auth.uid() limit 1), false) $f$;

create or replace function public.set_my_reminder_balance_setting(p_on boolean) returns boolean language plpgsql security definer set search_path = public, pg_temp
  as $f$ begin
   if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
   update public.instructors set mention_balance_in_reminders = coalesce(p_on, false) where auth_user_id = auth.uid();
   return coalesce(p_on, false);
  end $f$;

revoke execute on function public.get_my_reminder_balance_setting(), public.set_my_reminder_balance_setting(boolean) from public, anon;
grant execute on function public.get_my_reminder_balance_setting(), public.set_my_reminder_balance_setting(boolean) to authenticated, service_role;
