-- =============================================================================
-- Migration 039 — Revoke public EXECUTE on sensitive SECURITY DEFINER functions
-- =============================================================================
-- Found in a security review (26 Sept 2026) of the Supabase advisor's
-- "anon/authenticated can execute SECURITY DEFINER function" warnings.
--
-- link_student_to_auth(p_email, p_uid) (created in Migration 004) sets
-- students.auth_user_id for any unlinked student matching an email, to any uid
-- the caller supplies, and it was executable by anon and authenticated. Because
-- the students_self_read policy and ~10 other "self" policies key off
-- students.auth_user_id, anyone who knew a student's email could sign up an
-- account and link that student's record (lessons, DVSA tracking, reflective
-- logs, block bookings, test outcomes, ...) to it. Nothing in the app, backend
-- or database calls it, so it is simply closed off. service_role and the
-- owner keep EXECUTE.
--
-- can_add_instructor / can_add_student / count_active_students only need to be
-- reachable by the enforce_* trigger functions (which run as the owner) and the
-- backend (service_role). Signed-out callers could read a school's student
-- counts and tier limits by school id; anon/PUBLIC access is removed. Signed-in
-- users keep their explicit grant.
--
-- Deliberately NOT changed: is_school_owner and the current_user_* helpers
-- (used inside RLS policies; they only return facts about the caller), and the
-- trigger / event-trigger functions (not callable as ordinary RPCs).
--
-- Applied to the live ADI-PRO project on 26 Sept 2026. Idempotent.
-- =============================================================================

revoke execute on function public.link_student_to_auth(text, uuid) from public, anon, authenticated;

revoke execute on function public.can_add_instructor(uuid) from public, anon;
revoke execute on function public.can_add_student(uuid) from public, anon;
revoke execute on function public.count_active_students(uuid) from public, anon;

-- =============================================================================
-- DONE.
-- =============================================================================
