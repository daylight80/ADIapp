-- =============================================================================
-- Migration 041 — Link a student's login to their student row on confirmation
-- =============================================================================
-- Found 26 Sept 2026 while testing the Resend student invite: an invited student
-- accepted, signed in, and saw "We couldn't find your student profile".
--
-- Cause: the only student self-access policy is students_self_read
--   (auth.uid() = auth_user_id)
-- and the instructor creates the student row with auth_user_id NULL. Nothing ever
-- filled it in when the student accepted, so RLS hid their own row from them (the
-- by-email fallback lookup is blocked by the same policy). Migration 004's
-- link_student_to_auth() was meant for this but was never called by the app, and it
-- accepted an arbitrary uid from any caller (revoked in Migration 039).
--
-- Fix: an AFTER INSERT/UPDATE trigger on auth.users. When a login's email becomes
-- confirmed, link ONE unlinked student row with the same (verified) email:
--   - a login maps to exactly one student row (unique index ux_students_auth_user_id),
--     so linking every match would violate it when the same email appears on
--     several rows; the trigger picks one;
--   - it prefers the row the invite named (user metadata student_id, only used as a
--     tie-break among rows that already match the verified email), else the newest;
--   - all errors are swallowed so linking can never block sign-up or invite
--     acceptance;
--   - the function is not executable by anon/authenticated (triggers still fire).
--
-- One-off backfill: link a confirmed login only when unambiguous (the login has no
-- student yet and exactly one unlinked row carries its email). Logins matching
-- several unlinked rows are deliberately left for a human to resolve.
--
-- Applied to the live ADI-PRO project on 26 Sept 2026. Idempotent.
-- =============================================================================

create or replace function public.link_student_on_confirm() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  if new.email_confirmed_at is not null
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

drop trigger if exists link_student_on_confirm on auth.users;
create trigger link_student_on_confirm
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.link_student_on_confirm();

update public.students s
   set auth_user_id = u.id
  from auth.users u
 where s.auth_user_id is null
   and u.email_confirmed_at is not null
   and lower(u.email) = lower(s.email)
   and not exists (select 1 from public.students x where x.auth_user_id = u.id)
   and (select count(*) from public.students y
         where y.auth_user_id is null and lower(y.email) = lower(u.email)) = 1;

-- =============================================================================
-- DONE.
-- =============================================================================
