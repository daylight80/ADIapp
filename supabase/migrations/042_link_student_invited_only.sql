-- =============================================================================
-- Migration 042 — Only auto-link student logins that came from an invite
-- =============================================================================
-- Hardens the trigger added in Migration 041. Found 26 Sept 2026 while looking for
-- the "leaked password protection" setting: Supabase Auth's "Confirm email" is
-- switched OFF for this project. With it off, a self-service sign-up is marked
-- confirmed immediately without proving ownership of the address, so
-- email_confirmed_at alone is NOT proof of the email. As written in 041, anyone who
-- knew an unlinked student's email could sign up with it and be linked to that
-- student's record.
--
-- Fix: link only logins whose invited_at is set. invited_at is set by
-- /auth/v1/invite (called by the backend with the service key) and cannot be set by
-- a self-service sign-up; an invited login stays unconfirmed until the student
-- clicks the emailed link, which is genuine proof of the address.
--
-- If "Confirm email" is later switched ON (recommended now that Resend SMTP works),
-- this condition is still correct and can stay.
--
-- Applied to the live ADI-PRO project on 26 Sept 2026. Idempotent.
-- =============================================================================

create or replace function public.link_student_on_confirm() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  if new.invited_at is not null
     and new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null)
     and not exists (select 1 from public.students where auth_user_id = new.id) then
    select s.id into target
      from public.students s
     where lower(s.email) = lower(new.email)
       and s.auth_user_id is null
     order by (s.id::text = coalesce(new.raw_user_meta_data ->> 'student_id', '')) desc,
              s.created_at desc
     limit 1;
    if target is not null then
      update public.students set auth_user_id = new.id where id = target;
    end if;
  end if;
  return new;
exception when others then
  return new;
end $$;

revoke execute on function public.link_student_on_confirm() from public, anon, authenticated;

-- =============================================================================
-- DONE.
-- =============================================================================
