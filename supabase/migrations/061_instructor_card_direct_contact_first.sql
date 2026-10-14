-- A pupil contacts their instructor directly, before the driving school. my_instructor_card()
-- now returns the instructor's own mobile number and email first (the school's are the
-- fallback), and the school's own phone and email separately, only when they differ.
create or replace function public.my_instructor_card() returns jsonb
  language sql stable security definer set search_path = public, pg_temp
as $f$
  select jsonb_build_object(
    'instructor_name', i.full_name,
    'adi_number',      i.adi_number,
    'business_name',   nullif(btrim(d.business_name), ''),
    'contact_phone',   coalesce(nullif(btrim(i.mobile_number), ''), nullif(btrim(d.contact_phone), '')),
    'contact_email',   coalesce(nullif(btrim(i.email), ''), nullif(btrim(d.contact_email), '')),
    'school_phone',    case when nullif(btrim(d.contact_phone), '') is distinct from coalesce(nullif(btrim(i.mobile_number), ''), nullif(btrim(d.contact_phone), ''))
                            then nullif(btrim(d.contact_phone), '') end,
    'school_email',    case when nullif(btrim(d.contact_email), '') is distinct from coalesce(nullif(btrim(i.email), ''), nullif(btrim(d.contact_email), ''))
                            then nullif(btrim(d.contact_email), '') end,
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
