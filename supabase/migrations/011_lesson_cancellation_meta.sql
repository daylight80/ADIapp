-- =============================================================================
-- Migration 011 — Lesson cancellation metadata
-- =============================================================================
-- When an instructor cancels a lesson, they may choose to:
--   (a) Apply the FULL agreed price as a late-cancellation charge,
--   (b) Apply a PARTIAL charge (e.g. 50% — short-notice fee), or
--   (c) WAIVE the charge entirely.
--
-- We need an audit trail of which option was used and the £ amount recorded.
-- The `amount_paid` column on `lessons` already tracks money received from the
-- learner, so the new `cancellation_charge` column simply mirrors what was
-- actually retained on cancellation (could be 0). The `cancellation_note`
-- column stores a short human-readable explanation so it remains visible in
-- future reports / wallet views without needing to re-derive intent.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.lessons
    add column if not exists cancellation_note text;

alter table public.lessons
    add column if not exists cancellation_charge numeric(10, 2);

-- Lightweight index so finance reports can group cancellation revenue without
-- a sequential scan once volume grows.
create index if not exists idx_lessons_cancellation_charge
    on public.lessons (instructor_id, cancellation_charge)
    where cancellation_charge is not null;

-- =============================================================================
-- DONE.
-- =============================================================================
