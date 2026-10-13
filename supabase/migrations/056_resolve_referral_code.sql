-- A brand-new signup could not look up the referrer's code: row-level security hides every
-- other instructor from someone who is not yet an instructor, so the lookup in
-- AuthContext (instructors where referral_code = ...) always returned nothing and the
-- referral was silently dropped (found 13 Oct 2026: 0 referred schools despite a live code).
-- This function returns only the referrer's instructor id for a valid code.
create or replace function public.resolve_referral_code(p_code text) returns uuid
  language sql stable security definer set search_path = public, pg_temp
  as $f$ select id from public.instructors where referral_code = upper(btrim(p_code)) limit 1 $f$;
revoke execute on function public.resolve_referral_code(text) from public, anon;
grant execute on function public.resolve_referral_code(text) to authenticated, service_role;
