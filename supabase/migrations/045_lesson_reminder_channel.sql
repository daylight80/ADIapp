-- =============================================================================
-- Migration 045 — Record which channel a lesson reminder went out on
-- =============================================================================
-- Reminders can now go by email as well as push (48h prefers email, 25h prefers
-- push, each falling back to the other; 1h stays push-only). The log already
-- allows exactly one row per (lesson, reminder kind), which is exactly the
-- "never send the same reminder twice" rule we want across channels, so no new
-- kinds are needed — only a record of how it was delivered.
--
-- Why it matters beyond bookkeeping: the diary's reminder-status dot on the
-- student page reads this table. An email can never reach 'delivered' or
-- 'read' (there are no email receipts), so without a channel the app would show
-- a permanent red "sent — not yet delivered" for every emailed reminder.
--
-- Existing rows are all push, hence the default. Additive and idempotent;
-- the running backend keeps working before and after this is applied (it only
-- sends `channel` for email reminders).
-- =============================================================================

alter table public.lesson_reminder_log
    add column if not exists channel text not null default 'push';

alter table public.lesson_reminder_log
    drop constraint if exists lesson_reminder_log_channel_check;
alter table public.lesson_reminder_log
    add constraint lesson_reminder_log_channel_check check (channel in ('push', 'email'));

-- =============================================================================
-- DONE.
-- =============================================================================
