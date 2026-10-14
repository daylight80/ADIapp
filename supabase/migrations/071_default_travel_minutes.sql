-- An instructor's default travel buffer: the minutes after a lesson that new lessons start with (each
-- lesson still keeps its own travel_minutes, which the diary now draws after the lesson). 0 to 120,
-- default 15. Read and set through functions that only touch the caller's own row, so an instructor who
-- isn't the school owner can still change their own (the table's update policy is owner-only).
alter table public.instructors add column if not exists default_travel_minutes int not null default 15 check (default_travel_minutes between 0 and 120);

create or replace function public.get_my_default_travel_minutes() returns int
  language sql stable security definer set search_path = public, pg_temp
  as $f$ select coalesce((select i.default_travel_minutes from public.instructors i where i.auth_user_id = auth.uid() limit 1), 15) $f$;

create or replace function public.set_my_default_travel_minutes(p_minutes int) returns int
  language plpgsql security definer set search_path = public, pg_temp
  as $f$ begin
   if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
   if p_minutes is null or p_minutes < 0 or p_minutes > 120 then raise exception 'Travel buffer must be between 0 and 120 minutes' using errcode = '22023'; end if;
   update public.instructors set default_travel_minutes = p_minutes where auth_user_id = auth.uid();
   return p_minutes;
  end $f$;

revoke execute on function public.get_my_default_travel_minutes(), public.set_my_default_travel_minutes(int) from public, anon;
grant execute on function public.get_my_default_travel_minutes(), public.set_my_default_travel_minutes(int) to authenticated, service_role;
