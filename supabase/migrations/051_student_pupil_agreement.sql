-- Migration 051: the Pupil Agreement is signed by the student, not the instructor.
--
-- Until now the "Pupil Agreement" screen recorded a signature on the instructor's
-- own row, which meant the instructor was signing an agreement meant for their
-- pupils. The signature now lives on the student's row, and the student signs it
-- from their own dashboard. The instructor sees it (read-only) on the student's
-- profile because stu_instructor_select already lets them read their students.
--
-- Students have no UPDATE policy on students (and should not get one: it would
-- let them edit their own status, rate and so on), so signing goes through a
-- SECURITY DEFINER function that can only ever write these two columns on the
-- caller's own row, and only once.

alter table public.students
  add column if not exists tc_signed_at timestamptz,
  add column if not exists tc_signature_name text;

create or replace function public.sign_pupil_agreement_as_student(p_signature text)
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

  select s.id into sid from public.students s where s.auth_user_id = auth.uid() limit 1;
  if sid is null then
    raise exception 'No student record is linked to this account' using errcode = 'P0002';
  end if;

  -- First signature wins: signing again returns the existing record unchanged.
  update public.students s
     set tc_signed_at = now(), tc_signature_name = sig
   where s.id = sid and s.tc_signed_at is null;

  return query
    select s.tc_signed_at, s.tc_signature_name from public.students s where s.id = sid;
end;
$$;

revoke all on function public.sign_pupil_agreement_as_student(text) from public, anon;
grant execute on function public.sign_pupil_agreement_as_student(text) to authenticated;
