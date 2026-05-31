-- =============================================================================
-- Migration 009 — Lesson payment method
-- =============================================================================
-- Adds a payment_method column to the lessons table so instructors can record
-- HOW a learner paid: Bank Transfer, Card (physical reader), or Cash. Stripe
-- is intentionally NOT a valid value here — Stripe is only used for instructor
-- subscriptions to ADI Pro, never for student → instructor lesson payments.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.lessons
    add column if not exists payment_method text;

-- Enforce the only valid values (case-sensitive snake_case for consistency
-- with category enums elsewhere in the schema).
alter table public.lessons
    drop constraint if exists lessons_payment_method_chk;

alter table public.lessons
    add constraint lessons_payment_method_chk
    check (payment_method is null
           or payment_method in ('bank_transfer','card','cash'));

-- Lightweight index so the wallet/student-lifecycle views can filter & sum by
-- method without a sequential scan once the table grows.
create index if not exists idx_lessons_payment_method
    on public.lessons(school_id, payment_method)
    where payment_method is not null;

-- ---------------------------------------------------------------------------
-- block_bookings — same treatment (Bank Transfer / Card / Cash)
-- ---------------------------------------------------------------------------
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

-- =============================================================================
-- DONE.
-- =============================================================================
