-- =============================================================================
-- Migration 031 — Richer student post-lesson reflection
-- =============================================================================
-- reflective_logs already had what_well/what_difficult/next_focus (free
-- text) from Migration 002, but only what_well was ever actually used by
-- the UI. This adds a mood emoji + reason, and two independently-rated
-- 1-10 scales (understanding vs ability — a student can feel they
-- understood a concept without yet feeling confident performing it, so
-- these are deliberately separate, not one combined "how did it go?"
-- score). Inspired by a competitor review (22 Aug 2026) that structures
-- student reflection this way rather than a single free-text box.
-- =============================================================================

alter table public.reflective_logs
    add column if not exists mood_emoji text;

alter table public.reflective_logs
    add column if not exists mood_reason text;

alter table public.reflective_logs
    add column if not exists understanding_rating integer
        check (understanding_rating between 1 and 10);

alter table public.reflective_logs
    add column if not exists ability_rating integer
        check (ability_rating between 1 and 10);

-- =============================================================================
-- DONE.
-- =============================================================================
