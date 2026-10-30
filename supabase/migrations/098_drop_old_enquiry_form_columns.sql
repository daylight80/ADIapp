-- ============================================================================
-- Migration 098 — Remove the old website-form columns from driving_schools
-- ============================================================================
-- Migration 096 put the form key on driving_schools, where every instructor in the school can read it (policy
-- ds_instructor_read). Migration 097 moved the key and the switch to school_enquiry_forms, which only the school
-- owner can read, and the server now reads it from there. These two columns are the old, readable copy.
-- The unique index on the key goes with its column.
--
-- Idempotent. Apply only after the server code that reads school_enquiry_forms is live.
-- ============================================================================

alter table public.driving_schools
    drop column if exists enquiry_form_key,
    drop column if exists enquiry_form_enabled;
