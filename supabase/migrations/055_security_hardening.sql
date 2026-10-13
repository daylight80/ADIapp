-- Supabase security advisor, 13 Oct 2026.
-- 1. The "which school am I" helpers are used by row-level-security policies for signed-in
--    users only; signed-out visitors (anon) have no business calling them via /rest/v1/rpc.
revoke execute on function public.current_user_instructor_id(), public.current_user_instructor_school_id(),
  public.current_user_school_ids(), public.is_school_owner(uuid) from public, anon;
grant execute on function public.current_user_instructor_id(), public.current_user_instructor_school_id(),
  public.current_user_school_ids(), public.is_school_owner(uuid) to authenticated, service_role;

-- 2. Pin the search path on the eight functions that had none.
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.tier_student_limit(text) set search_path = public, pg_temp;
alter function public.tier_instructor_limit(text) set search_path = public, pg_temp;
alter function public.set_lesson_packages_updated_at() set search_path = public, pg_temp;
alter function public.seed_lesson_packages_for_new_instructor() set search_path = public, pg_temp;
alter function public.set_updated_at_timestamp() set search_path = public, pg_temp;
alter function public.set_expense_receipts_updated_at() set search_path = public, pg_temp;
alter function public.students_set_notes_updated_at() set search_path = public, pg_temp;
