-- =============================================================================
-- Migration 012 — Per-instructor iCal (.ics) calendar feed token
-- =============================================================================
-- Lets an instructor opt-in to a shareable read-only diary URL that Apple
-- Calendar / Google Calendar / Outlook can subscribe to. The token is a
-- 30-ish-char random URL-safe string stored on the instructors row. A NULL
-- value means the feature is disabled for that instructor. Rotating the token
-- via the /api/calendar/regenerate endpoint instantly revokes any previously
-- shared link.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.instructors
    add column if not exists calendar_feed_token text;

-- A token must be unique across the table so the public lookup at
-- GET /api/calendar/{token}.ics resolves to exactly one instructor.
create unique index if not exists idx_instructors_calendar_feed_token
    on public.instructors (calendar_feed_token)
    where calendar_feed_token is not null;

-- =============================================================================
-- DONE.
-- =============================================================================
