-- =============================================================================
-- Migration 028 — School profile: default hourly rate + Google review URL
-- =============================================================================
-- Distinct from students.hourly_rate (Migration 002), which is a per-student
-- negotiated rate. This is the school-wide standard/default rate, shown on
-- the School Profile screen — not automatically applied to existing
-- students, just a stated reference figure for the school.
-- =============================================================================

alter table public.driving_schools
    add column if not exists default_hourly_rate numeric;

alter table public.driving_schools
    add column if not exists google_review_url text;

-- =============================================================================
-- DONE.
-- =============================================================================
