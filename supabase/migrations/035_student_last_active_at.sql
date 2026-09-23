-- =============================================================================
-- Migration 035 — Student app-usage tracking (Phase 2 of the "not using
-- the app" indicator)
-- =============================================================================
-- Phase 1 (Migration-free) showed whether a student has ever linked an
-- account at all, using the already-existing auth_user_id. This is the
-- next tier: a student who HAS an account but has gone quiet. Stamped by
-- the student app itself on every launch (see AuthContext.tsx's new
-- effect), surfaced to the instructor as "Last seen X days ago" —
-- matching what the MyDriveTime research this feature is based on
-- actually shows in its Select Students broadcast screen.
-- =============================================================================

alter table public.students
    add column if not exists last_active_at timestamptz;

-- =============================================================================
-- DONE.
-- =============================================================================
