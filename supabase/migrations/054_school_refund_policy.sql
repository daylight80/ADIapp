-- Migration 054: each school chooses its own refund policy for the Pupil Agreement.
--
-- The DVSA code of practice (section 10) says an instructor's terms of business must
-- include a refund policy, but what that policy is varies by school. The standard
-- agreement used to hard-code "non-refundable but transferable". It now shows the
-- school's choice. The default stays 'non_refundable' so nothing changes for a school
-- until it picks something else.
--
-- Owners can already update their own driving_schools row (ds_owner_all), which covers
-- solo instructors (their own school) and Franchise owners.

alter table public.driving_schools
  add column if not exists refund_policy text not null default 'non_refundable';

alter table public.driving_schools
  drop constraint if exists driving_schools_refund_policy_check;
alter table public.driving_schools
  add constraint driving_schools_refund_policy_check
  check (refund_policy in ('non_refundable', 'refund_14_days', 'refund_any_time', 'credit_only'));

-- The pupil's agreement context now also carries the school's refund policy.
create or replace function public.my_pupil_agreement_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'instructor_name', i.full_name,
    'adi_number',      i.adi_number,
    'business_name',   nullif(btrim(d.business_name), ''),
    'contact_phone',   coalesce(nullif(btrim(d.contact_phone), ''), nullif(btrim(i.mobile_number), '')),
    'contact_email',   coalesce(nullif(btrim(d.contact_email), ''), nullif(btrim(i.email), '')),
    'address',         coalesce(nullif(btrim(d.address), ''), nullif(btrim(i.address), '')),
    'hourly_rate',     s.hourly_rate,
    'custom_text',     nullif(btrim(d.pupil_agreement_text), ''),
    'refund_policy',   d.refund_policy
  )
  from public.students s
  left join public.instructors i on i.id = s.instructor_id
  left join public.driving_schools d on d.id = s.school_id
  where s.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.my_pupil_agreement_context() from public, anon;
grant execute on function public.my_pupil_agreement_context() to authenticated;
