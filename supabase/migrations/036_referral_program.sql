-- =============================================================================
-- Migration 036 — Referral program
-- =============================================================================
-- "Refer a driving instructor, get 1 month free" banner, per Grant
-- directly (23 Sept 2026). Per his own answers to the three open design
-- questions this needed before it could be built safely:
--   - Reward triggers only once the referred instructor's school actually
--     becomes a PAYING subscriber (checkout.session.completed in the
--     existing Stripe webhook) — not on bare signup, which would be
--     trivial to game with fake accounts.
--   - Only the referrer is rewarded — the referred instructor gets
--     nothing extra beyond ADI Pro itself.
--   - Capped at REFERRAL_MAX_REWARDS_PER_YEAR (server.py) rewarded
--     referrals per rolling 12 months per referrer — set to 6 as a
--     starting point (Grant's own suggested range was 3-6); trivial to
--     adjust, it's a single named constant.
--
-- No separate referrals table — a school can only ever be referred by
-- one instructor, so this is a 1:1 relationship that fits directly on
-- driving_schools rather than needing its own join table.
-- =============================================================================

alter table public.instructors
    add column if not exists referral_code text unique;

alter table public.driving_schools
    add column if not exists referred_by_instructor_id uuid references public.instructors(id);

alter table public.driving_schools
    add column if not exists referral_reward_status text check (referral_reward_status in ('pending', 'rewarded', 'capped'));

alter table public.driving_schools
    add column if not exists referral_resolved_at timestamptz;

create index if not exists idx_driving_schools_referred_by
    on public.driving_schools(referred_by_instructor_id);

-- =============================================================================
-- DONE.
-- =============================================================================
