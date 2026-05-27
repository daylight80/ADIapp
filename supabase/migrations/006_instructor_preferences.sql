-- =============================================================================
-- Migration 006 — Instructor preferences: preferred_nav_app
-- =============================================================================
-- Adds a `preferred_nav_app` column on `public.instructors` so each instructor
-- can pick which navigation app the diary's one-tap 🧭 button should launch
-- (Google Maps / Waze / Apple Maps).
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.instructors
    add column if not exists preferred_nav_app text not null default 'google';

-- Enforce the only three valid values. Drop & recreate so the check stays
-- consistent across re-runs.
alter table public.instructors
    drop constraint if exists instructors_preferred_nav_app_chk;

alter table public.instructors
    add constraint instructors_preferred_nav_app_chk
    check (preferred_nav_app in ('google', 'waze', 'apple'));

-- Backfill any nulls (paranoia — column is NOT NULL default 'google').
update public.instructors
   set preferred_nav_app = 'google'
 where preferred_nav_app is null;

-- =============================================================================
-- DONE.
-- =============================================================================
