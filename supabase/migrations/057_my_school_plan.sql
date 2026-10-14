-- A pupil's app decides what to unlock (the DVSA tracker, etc.) from their instructor's plan.
-- It read the plan by embedding driving_schools in the students query, but pupils cannot read
-- driving_schools (row-level security), so the plan always came back empty and defaulted to
-- 'starter': a pupil of a Pro instructor saw "Tracker locked" (found 14 Oct 2026).
-- This returns just the tier and subscription status of the caller's own school.
create or replace function public.my_school_plan() returns jsonb
  language sql stable security definer set search_path = public, pg_temp
  as $f$ select jsonb_build_object('tier', d.tier, 'subscription_status', d.subscription_status)
         from public.students s join public.driving_schools d on d.id = s.school_id
         where s.auth_user_id = auth.uid() limit 1 $f$;
revoke execute on function public.my_school_plan() from public, anon;
grant execute on function public.my_school_plan() to authenticated, service_role;
