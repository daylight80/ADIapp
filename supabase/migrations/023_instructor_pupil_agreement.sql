-- =============================================================================
-- Migration 023 — Pupil Agreement signature (was mock-only, never persisted)
-- =============================================================================
-- onboarding-tc-screen.tsx previously wrote the signed-T&C timestamp and
-- signature name onto a module-level mock object (`instructorProfile` in
-- mockDb.ts) that lives only in memory and is discarded on app restart.
-- That meant a legally-relevant consent record was never actually saved
-- anywhere. This migration adds real, durable columns for it.
-- =============================================================================

alter table public.instructors
    add column if not exists tc_signed_at timestamptz;

alter table public.instructors
    add column if not exists tc_signature_name text;

-- =============================================================================
-- DONE.
-- =============================================================================
