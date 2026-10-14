-- The plan belongs to the instructor's school (the subscription owner), not to anything the
-- pupil owns. my_school_plan() now follows pupil -> their instructor -> the instructor's
-- school, so a pupil of an instructor in a Franchise school gets that school's plan.
create or replace function public.my_school_plan() returns jsonb
  language sql stable security definer set search_path = public, pg_temp
  as $f$ select jsonb_build_object('tier', d.tier, 'subscription_status', d.subscription_status)
         from public.students s
         join public.instructors i on i.id = s.instructor_id
         join public.driving_schools d on d.id = i.school_id
         where s.auth_user_id = auth.uid() limit 1 $f$;
