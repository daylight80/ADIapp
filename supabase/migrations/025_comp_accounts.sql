-- =============================================================================
-- Migration 025 — Comp accounts (manually-granted tier, protected from Stripe)
-- =============================================================================
-- For giving a specific school free permanent access to a tier (e.g. a
-- partner, a demo account, a goodwill gesture) without it ever being at risk
-- of being silently overwritten by a real Stripe webhook event — e.g. if
-- that school's owner ever clicks through a real checkout by habit, or an
-- old subscription event from before they were comped arrives late.
--
-- Comp accounts are set up manually (SQL below), not through any in-app UI.
-- =============================================================================

alter table public.driving_schools
    add column if not exists is_comp_account boolean not null default false;

comment on column public.driving_schools.is_comp_account is
    'When true, the Stripe webhook skips writing tier/subscription_status for this school entirely — set manually for comped/partner accounts.';

-- =============================================================================
-- To comp a specific school to Franchise permanently, run (with the real id):
--
--   update driving_schools
--   set tier = 'franchise', is_comp_account = true
--   where id = '<school id>';
--
-- To find a school's id from the owner's email, join through auth.users:
--
--   select ds.id, ds.business_name, ds.tier
--   from driving_schools ds
--   join auth.users u on u.id = ds.owner_auth_id
--   where u.email = '<owner email>';
-- =============================================================================
