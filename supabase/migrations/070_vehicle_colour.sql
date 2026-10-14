-- Vehicle colour, on the Vehicles page. The pupil's Instructor tab already shows the school's default
-- vehicle (migration 060/061), so my_instructor_card() now includes its colour ("Look out for the
-- silver VW Golf"). Optional, up to 40 characters. Existing vehicles keep an empty colour.
alter table public.vehicles add column if not exists colour text check (colour is null or char_length(colour) <= 40);

create or replace function public.my_instructor_card()
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp'
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
        select jsonb_build_object('make_and_model', v.make_and_model, 'registration_plate', v.registration_plate, 'transmission', v.transmission, 'colour', nullif(btrim(v.colour), ''))
          from public.vehicles v where v.school_id = i.school_id
         order by v.is_default desc, v.created_at limit 1)
      else null end)
  from public.students s
  join public.instructors i on i.id = s.instructor_id
  join public.driving_schools d on d.id = i.school_id
  where s.auth_user_id = auth.uid()
  limit 1
$f$;
