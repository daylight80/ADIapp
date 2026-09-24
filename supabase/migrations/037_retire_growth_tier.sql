-- =============================================================================
-- Migration 037 — Retire the Growth tier
-- =============================================================================
-- Tiers and pricing restructuring (23 Sept 2026), per Grant directly,
-- following the Drive My Way pricing comparison in this session's
-- planning doc:
--   - Starter: unchanged.
--   - Growth (£14.99/mo, capped at 15 students): REMOVED. It sat priced
--     above Drive My Way's own unlimited-student solo tier — a genuinely
--     bad competitive position, not just a rounding issue.
--   - Pro: retitled "ADI Pro" in the UI and repriced £24.99 -> £11.99,
--     matching Drive My Way's Solo Instructor tier exactly. The
--     database/code id stays 'pro' — only the display name and price
--     changed, so this migration needs no schema change and no id
--     rewrite for existing 'pro' rows.
--   - Franchise: repriced £39.99+£10/seat -> £13.99+£9.99/seat, matching
--     Drive My Way's Driving School tier exactly. Name and id unchanged.
--
-- Per Grant's explicit choice: every existing subscriber moves to the
-- new pricing, no grandfathering, no exceptions — including current Pro
-- and Franchise subscribers, not just Growth ones. The row-level part of
-- that (existing tier='growth' schools moving onto 'pro') is this
-- migration. The Stripe side (creating new Price objects at the new
-- amounts and moving live subscriptions onto them, since Stripe Prices
-- are immutable once created) is a separate script — see
-- scripts/migrate_stripe_prices.py — run only after the new Stripe
-- Price objects exist and STRIPE_PRICE_PRO / STRIPE_PRICE_FRANCHISE_*
-- point at them.
-- =============================================================================

update public.driving_schools
    set tier = 'pro'
    where tier = 'growth';

-- =============================================================================
-- DONE.
-- =============================================================================
