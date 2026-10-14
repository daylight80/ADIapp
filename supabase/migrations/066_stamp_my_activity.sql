-- Pupils have no UPDATE policy on students, so the app's "last opened" stamp updated 0 rows and
-- every pupil showed as "Hasn't opened the app yet". This lets a signed-in pupil stamp only their own row.
create or replace function public.stamp_my_activity() returns void
  language sql security definer set search_path = public, pg_temp
as $f$ update public.students set last_active_at = now() where auth_user_id = auth.uid() $f$;

revoke execute on function public.stamp_my_activity() from public, anon;
grant execute on function public.stamp_my_activity() to authenticated, service_role;
