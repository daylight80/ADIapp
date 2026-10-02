-- ============================================================================
-- Migration 050 — block_bookings.payment_method (the missing half of 009)
-- ============================================================================
-- Migration 009 was written to add payment_method to BOTH lessons and
-- block_bookings, but on the live database only the lessons half is present:
-- block_bookings has no payment_method column. The wallet sends payment_method
-- when it records a block, so every attempt failed with "Could not find the
-- 'payment_method' column", and no block booking has ever been created.
--
-- This applies the block_bookings half of 009 again, unchanged (Bank Transfer /
-- Card / Cash, or not recorded). Nothing is lost: block_bookings is empty.
--
-- Idempotent: safe to re-run, and a no-op wherever 009 already took effect.
-- ============================================================================

alter table public.block_bookings
    add column if not exists payment_method text;

alter table public.block_bookings
    drop constraint if exists block_bookings_payment_method_chk;

alter table public.block_bookings
    add constraint block_bookings_payment_method_chk
    check (payment_method is null
           or payment_method in ('bank_transfer','card','cash'));

create index if not exists idx_block_bookings_payment_method
    on public.block_bookings(student_id, payment_method)
    where payment_method is not null;

-- ============================================================================
-- DONE.
-- ============================================================================
