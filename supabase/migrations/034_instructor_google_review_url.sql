-- =============================================================================
-- Migration 034 — Instructor-level Google review URL (for solo tiers)
-- =============================================================================
-- driving_schools.google_review_url already exists (Migration 028), read via
-- School Profile — but that screen is reached only through owner_auth_id on
-- driving_schools, which is conceptually and navigationally a Franchise
-- screen; solo tiers (Starter/Growth/Pro) have no menu path to it at all,
-- even though the underlying row technically exists and works for them too.
-- Per Grant directly (21 Sept 2026): add the same setting directly on the
-- instructor's own row instead, alongside car_make/number_plate/etc, so it
-- lives in My Details — the one settings screen solo tiers actually use —
-- rather than sending them to a screen built for multi-instructor schools.
-- Franchise keeps using driving_schools.google_review_url unchanged.
-- =============================================================================

alter table public.instructors
    add column if not exists google_review_url text;

-- =============================================================================
-- DONE.
-- =============================================================================
