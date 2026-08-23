-- =============================================================================
-- Migration 032 — Structured lesson type, for diary color-coding
-- =============================================================================
-- lessons already had a free-text `topic` field (e.g. "Roundabouts and
-- junctions") for what's actually being taught — this adds a separate,
-- structured `lesson_type` for what KIND of lesson it is, so the diary can
-- color-code by type at a glance. Deliberately a plain text column, not a
-- DB-level enum — the frontend offers a fixed set of standard types (see
-- LESSON_TYPES in diary/lessonTypes.ts) but this keeps the door open
-- without a migration if that list ever needs to change.
-- =============================================================================

alter table public.lessons
    add column if not exists lesson_type text not null default 'Standard';

-- =============================================================================
-- DONE.
-- =============================================================================
