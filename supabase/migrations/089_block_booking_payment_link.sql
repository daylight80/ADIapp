-- ============================================================================
-- Migration 089 — Link prepaid hours to the payment that bought them
-- ============================================================================
-- Ticking "Also add hours" on Record a payment records the money as a payment and adds the hours as a prepaid block
-- with no amount of its own (so the money is counted once). The Wallet screen therefore showed "£0" on those hours and
-- a Total paid that ignored them, while Earnings counted the payment, so the two screens disagreed (seen in a screen
-- recording: three £80 payments with hours, Wallet still reading Total paid £152).
--
--   block_bookings.payment_id        the payment that bought these hours, when they were added with a payment.
--   block_bookings_with_money        each block with money_gbp: its own amount, or the linked payment's amount when it
--                                    has none (a voided payment counts as nothing). The Wallet reads this, so its
--                                    figures match Earnings. The balance view is unchanged and still counts the money
--                                    once, through the payment.
-- Hours added before this migration are linked by matching the payment recorded in the same moment (within 5 seconds,
-- same pupil, same method).
-- Idempotent.
-- ============================================================================

alter table public.block_bookings add column if not exists payment_id uuid references public.payments(id) on delete set null;

create index if not exists idx_block_bookings_payment on public.block_bookings(payment_id) where payment_id is not null;

create or replace view public.block_bookings_with_money with (security_invoker = true) as
  select b.*,
         case when coalesce(b.amount, 0) > 0 then b.amount
              else coalesce(p.amount, 0) end as money_gbp
    from public.block_bookings b
    left join public.payments p on p.id = b.payment_id and p.voided_at is null;

-- Link earlier "added with a payment" hours to the payment recorded at the same moment.
update public.block_bookings b
   set payment_id = m.payment_id
  from (
    select distinct on (bb.id) bb.id as block_id, p.id as payment_id
      from public.block_bookings bb
      join public.payments p
        on p.student_id = bb.student_id
       and p.source = 'manual'
       and p.method = coalesce(bb.payment_method, p.method)
       and abs(extract(epoch from (p.created_at - bb.created_at))) <= 5
     where coalesce(bb.amount, 0) = 0 and bb.payment_id is null and bb.gift_voucher_id is null
       and not exists (select 1 from public.block_bookings x where x.payment_id = p.id)
     order by bb.id, abs(extract(epoch from (p.created_at - bb.created_at)))
  ) m
 where b.id = m.block_id and b.payment_id is null;
