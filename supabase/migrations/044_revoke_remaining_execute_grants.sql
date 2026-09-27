-- =============================================================================
-- Migration 044 — Revoke remaining unnecessary EXECUTE grants on
-- SECURITY DEFINER functions
-- =============================================================================
-- Follow-up to Migration 039, which revoked anon EXECUTE on
-- can_add_instructor/can_add_student/count_active_students but left the
-- authenticated grant in place, and deliberately left the trigger / event
-- trigger functions untouched. Reviewing the remaining ~12 functions the
-- Supabase advisor flags as SECURITY DEFINER + publicly executable:
--
-- 1) can_add_instructor(school) / can_add_student(school) /
--    count_active_students(school) — still executable by any signed-in user
--    for ANY school uuid, not just their own. Confirmed via grep that the
--    app never calls these directly: the backend only reaches them through
--    the enforce_* triggers (which run SECURITY DEFINER as the owner, so no
--    grant is needed) and, for can_add_instructor, one direct call that
--    always uses the service-role key (bypasses grants entirely). So the
--    authenticated grant serves no purpose and only lets any logged-in
--    instructor/student query another school's capacity or exact active
--    student count by uuid. Revoked.
--
-- 2) enforce_instructor_limit() / enforce_student_limit() /
--    recount_seat_count() / recount_student_lessons() — RETURNS trigger.
--    Postgres refuses to run a trigger function outside trigger context
--    ("trigger functions can only be called as triggers"), so the existing
--    anon/authenticated grants were never actually exploitable — but they
--    still show up as advisor warnings and serve no purpose, so they're
--    revoked for least privilege.
--
-- 3) rls_auto_enable() — RETURNS event_trigger, same story: not callable as
--    an ordinary RPC, grant revoked for the same reason.
--
-- Deliberately NOT changed: is_school_owner() and the current_user_*()
-- helpers. They're used inside RLS policies throughout the schema and only
-- ever return facts derived from the caller's own auth.uid() (their own
-- instructor id / school id / ownership) — safe for anon and authenticated
-- to call directly, and several policies rely on being able to.
--
-- Applied to the live ADI-PRO project. Idempotent.
-- =============================================================================

revoke execute on function public.can_add_instructor(uuid) from authenticated;
revoke execute on function public.can_add_student(uuid) from authenticated;
revoke execute on function public.count_active_students(uuid) from authenticated;

-- Functions default to PUBLIC EXECUTE at creation time, and every role is an
-- implicit member of PUBLIC — so revoking only from anon/authenticated is not
-- enough on its own; PUBLIC must be revoked too or the grant is still live.
revoke execute on function public.enforce_instructor_limit() from public, anon, authenticated;
revoke execute on function public.enforce_student_limit() from public, anon, authenticated;
revoke execute on function public.recount_seat_count() from public, anon, authenticated;
revoke execute on function public.recount_student_lessons() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- =============================================================================
-- DONE.
-- =============================================================================
