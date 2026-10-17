-- The instructor's default hourly rate (set on Pricing & packages) as one source of truth, and a way to apply a
-- changed default to existing pupils. Functions that only touch the caller's own row and own pupils, because
-- the instructors table can only be updated directly by a school owner (so a franchise instructor's save
-- would otherwise change nothing).
--   get/set_my_default_hourly_rate    read and change instructors.default_hourly_rate (0.01 to 500)
--   my_pupil_rate_counts()            [{rate, pupils}] for the caller's pupils, to show who is on which rate
--   apply_default_rate_to_my_pupils() sets the rate on the caller's pupils; with p_only_old_rate, only those
--                                     currently on that rate (so deliberately different rates are left alone)
create or replace function public.get_my_default_hourly_rate() returns numeric language sql stable security definer set search_path = public, pg_temp
  as $f$ select coalesce((select i.default_hourly_rate from public.instructors i where i.auth_user_id = auth.uid() limit 1), 36) $f$;

create or replace function public.set_my_default_hourly_rate(p_rate numeric) returns numeric language plpgsql security definer set search_path = public, pg_temp
  as $f$ begin
   if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
   if p_rate is null or p_rate <= 0 or p_rate > 500 then raise exception 'Enter an hourly rate between £0.01 and £500.' using errcode = '22023'; end if;
   update public.instructors set default_hourly_rate = round(p_rate, 2) where auth_user_id = auth.uid();
   return round(p_rate, 2);
  end $f$;

create or replace function public.my_pupil_rate_counts() returns jsonb language sql stable security definer set search_path = public, pg_temp
  as $f$ select coalesce(jsonb_agg(jsonb_build_object('rate', t.rate, 'pupils', t.n) order by t.rate), '[]'::jsonb)
         from (select s.hourly_rate as rate, count(*) as n from public.students s where s.instructor_id = public.current_user_instructor_id() group by s.hourly_rate) t $f$;

create or replace function public.apply_default_rate_to_my_pupils(p_rate numeric, p_only_old_rate numeric default null) returns int language plpgsql security definer set search_path = public, pg_temp
  as $f$ declare n int; begin
   if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
   if p_rate is null or p_rate <= 0 or p_rate > 500 then raise exception 'Enter an hourly rate between £0.01 and £500.' using errcode = '22023'; end if;
   update public.students set hourly_rate = round(p_rate, 2)
    where instructor_id = public.current_user_instructor_id() and hourly_rate <> round(p_rate, 2)
      and (p_only_old_rate is null or hourly_rate = p_only_old_rate);
   get diagnostics n = row_count;
   return n;
  end $f$;

revoke execute on function public.get_my_default_hourly_rate(), public.set_my_default_hourly_rate(numeric), public.my_pupil_rate_counts(), public.apply_default_rate_to_my_pupils(numeric, numeric) from public, anon;
grant execute on function public.get_my_default_hourly_rate(), public.set_my_default_hourly_rate(numeric), public.my_pupil_rate_counts(), public.apply_default_rate_to_my_pupils(numeric, numeric) to authenticated, service_role;
