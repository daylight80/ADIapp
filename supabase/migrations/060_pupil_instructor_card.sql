-- What a pupil sees on their Instructor tab: the instructor's name, ADI number, business
-- contact details and (if the school allows it) the car to look for at pickup. Pupils cannot
-- read instructors, driving_schools or vehicles, so this is a function that returns only
-- those fields, for the caller's own instructor.
--
-- driving_schools.share_vehicle_with_pupils (default true) lets the school hide the car
-- details; the switch is on the Vehicles screen. The car is the school's default vehicle,
-- or its first one: vehicles belong to the school, not to a single instructor.
alter table public.driving_schools
  add column if not exists share_vehicle_with_pupils boolean not null default true;

create or replace function public.my_instructor_card() returns jsonb
  language sql stable security definer set search_path = public, pg_temp
as $f$
  select jsonb_build_object(
    'instructor_name', i.full_name,
    'adi_number',      i.adi_number,
    'business_name',   nullif(btrim(d.business_name), ''),
    'contact_phone',   coalesce(nullif(btrim(d.contact_phone), ''), nullif(btrim(i.mobile_number), '')),
    'contact_email',   coalesce(nullif(btrim(d.contact_email), ''), nullif(btrim(i.email), '')),
    'vehicle', case when d.share_vehicle_with_pupils then (
        select jsonb_build_object('make_and_model', v.make_and_model, 'registration_plate', v.registration_plate, 'transmission', v.transmission)
          from public.vehicles v where v.school_id = i.school_id
         order by v.is_default desc, v.created_at limit 1)
      else null end)
  from public.students s
  join public.instructors i on i.id = s.instructor_id
  join public.driving_schools d on d.id = i.school_id
  where s.auth_user_id = auth.uid()
  limit 1
$f$;
revoke execute on function public.my_instructor_card() from public, anon;
grant execute on function public.my_instructor_card() to authenticated, service_role;
