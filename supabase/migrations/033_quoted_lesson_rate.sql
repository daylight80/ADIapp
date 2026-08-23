-- =============================================================================
-- Migration 033 — Quoted lesson rate, distinct from amount_paid
-- =============================================================================
-- amount_paid tracks whether a lesson has actually been paid for, and
-- deliberately starts unset at creation until the instructor records real
-- payment (e.g. via Mark Complete). This adds a separate field for the
-- expected/quoted price at booking time — pre-filling amount_paid instead
-- would have made every new lesson look already-paid before it even
-- happened, corrupting arrears and wallet balance calculations.
-- =============================================================================

alter table public.lessons
    add column if not exists quoted_amount numeric;

-- =============================================================================
-- DONE.
-- =============================================================================
