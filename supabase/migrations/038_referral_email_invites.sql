-- =============================================================================
-- Migration 038 — Referral email invites (rate limiting + de-duplication)
-- =============================================================================
-- Backs POST /api/referrals/invite-by-email (server.py). One row per referral
-- email sent, used to:
--   - cap how many an instructor can send per rolling 24 hours, and
--   - stop the same address being emailed repeatedly (by any instructor)
--     inside a 30-day window.
--
-- Only the backend touches this table, via the service-role key, which
-- bypasses RLS. RLS is enabled with NO policies on purpose, so the anon and
-- authenticated roles (i.e. the mobile app talking to Supabase directly) can
-- neither read nor write it — recipient addresses are other people's data.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.referral_email_invites (
    id               uuid primary key default gen_random_uuid(),
    instructor_id    uuid not null references public.instructors(id) on delete cascade,
    recipient_email  text not null,   -- stored lower-cased
    created_at       timestamptz not null default now()
);

create index if not exists idx_referral_invites_instructor_time
    on public.referral_email_invites(instructor_id, created_at desc);

create index if not exists idx_referral_invites_recipient_time
    on public.referral_email_invites(recipient_email, created_at desc);

alter table public.referral_email_invites enable row level security;

-- =============================================================================
-- DONE.
-- =============================================================================
