-- When a school first became a paying subscriber. The referral banner only appears once this is
-- at least a month ago. Set by the Stripe webhook on the first successful checkout (never moved
-- afterwards), so a plan change or renewal doesn't restart the clock.
alter table public.driving_schools add column if not exists subscribed_since timestamptz;

-- Schools already on an active paid plan: count from when the school was created (best record we have).
update public.driving_schools set subscribed_since = created_at
 where subscribed_since is null and subscription_status = 'active' and coalesce(is_comp_account, false) = false;
