-- Migration 053: Pupil Agreement details for the DVSA code of practice.
--
-- The new mandatory ADI code of practice (section 10) says an instructor's terms of
-- business must give the pupil, in writing before lessons start: the business contact
-- details, the price and duration of lessons, the cancellation and refund policies,
-- how their personal data is handled and how to make a complaint.
--
-- 1. my_pupil_agreement_context(): the instructor/business contact details and the
--    pupil's own hourly rate, so the agreement can show them. A student cannot read
--    instructors or driving_schools directly (and should not: those rows hold billing
--    state), so this is a SECURITY DEFINER function returning only these fields for the
--    caller's own instructor and school. It also returns the school's own agreement text
--    (what my_pupil_agreement_text() from Migration 052 returned).
-- 2. students.tc_agreed_text: a copy of the exact wording the pupil agreed to, kept with
--    the signature, so the record shows what was signed even if the school edits its
--    terms later. sign_pupil_agreement_as_student() takes it as an optional second
--    argument; the old one-argument version is replaced.

alter table public.students
  add column if not exists tc_agreed_text text;

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
    'custom_text',     nullif(btrim(d.pupil_agreement_text), '')
  )
  from public.students s
  left join public.instructors i on i.id = s.instructor_id
  left join public.driving_schools d on d.id = s.school_id
  where s.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.my_pupil_agreement_context() from public, anon;
grant execute on function public.my_pupil_agreement_context() to authenticated;

drop function if exists public.sign_pupil_agreement_as_student(text);

create or replace function public.sign_pupil_agreement_as_student(p_signature text, p_agreement_text text default null)
returns table (tc_signed_at timestamptz, tc_signature_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  sig text := btrim(coalesce(p_signature, ''));
  sid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if char_length(sig) < 3 or char_length(sig) > 120 then
    raise exception 'Signature must be between 3 and 120 characters' using errcode = '22023';
  end if;
  if p_agreement_text is not null and char_length(p_agreement_text) > 50000 then
    raise exception 'Agreement text is too long' using errcode = '22023';
  end if;

  select s.id into sid from public.students s where s.auth_user_id = auth.uid() limit 1;
  if sid is null then
    raise exception 'No student record is linked to this account' using errcode = 'P0002';
  end if;

  -- First signature wins: signing again returns the existing record unchanged.
  update public.students s
     set tc_signed_at = now(), tc_signature_name = sig, tc_agreed_text = p_agreement_text
   where s.id = sid and s.tc_signed_at is null;

  return query
    select s.tc_signed_at, s.tc_signature_name from public.students s where s.id = sid;
end;
$$;

revoke all on function public.sign_pupil_agreement_as_student(text, text) from public, anon;
grant execute on function public.sign_pupil_agreement_as_student(text, text) to authenticated;
