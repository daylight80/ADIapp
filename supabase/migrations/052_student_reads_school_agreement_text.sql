-- Migration 052: let a student read their own school's Pupil Agreement wording.
--
-- The school owner can write their own agreement text (driving_schools.
-- pupil_agreement_text), but students have no read access to driving_schools
-- (and should not: it holds Stripe ids and billing state). This returns only
-- that one column, for the caller's own school, via a SECURITY DEFINER function.

create or replace function public.my_pupil_agreement_text()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.pupil_agreement_text
    from public.students s
    join public.driving_schools d on d.id = s.school_id
   where s.auth_user_id = auth.uid()
   limit 1;
$$;

revoke all on function public.my_pupil_agreement_text() from public, anon;
grant execute on function public.my_pupil_agreement_text() to authenticated;
