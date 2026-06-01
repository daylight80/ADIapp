-- =============================================================================
-- Migration 016 — Recurring lesson series link
-- =============================================================================
-- Adds a single column to public.lessons that ties every occurrence of a
-- recurring lesson together. When an instructor toggles "Repeat weekly" on
-- the Add Lesson sheet, the client mints ONE uuid and stamps every created
-- row with the same value, so we can later:
--
--   * bulk-cancel all remaining occurrences ("Cancel all remaining"),
--   * bulk-edit topic / travel-minutes / pickup_address etc.,
--   * count occurrences in a series for analytics.
--
-- The column is NULLABLE — single (non-recurring) lessons keep series_id = NULL.
-- The partial index keeps existing-row lookups cheap without bloating the
-- index for the (much larger) single-lesson set.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.lessons
    add column if not exists series_id uuid;

create index if not exists idx_lessons_series_id
    on public.lessons (series_id)
    where series_id is not null;

-- =============================================================================
-- DONE.
-- =============================================================================
