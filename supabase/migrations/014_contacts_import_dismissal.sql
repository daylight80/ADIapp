-- =============================================================================
-- Migration 014 — Persist "Import contacts" onboarding banner dismissal
-- =============================================================================
-- When an instructor taps either CTA on the Contacts Import banner (the
-- primary orange "Import Students from Contacts" OR the secondary muted
-- "I'll Do This Later"), we record a timestamp so the banner never re-shows
-- for that instructor on any device. Per user spec 3c — "Hide forever; they
-- can still find it manually in Profile → Import contacts".
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.instructors
    add column if not exists contacts_import_dismissed_at timestamptz;

-- =============================================================================
-- DONE.
-- =============================================================================
