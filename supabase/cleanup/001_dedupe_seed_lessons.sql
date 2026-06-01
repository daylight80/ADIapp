-- =============================================================================
-- Cleanup 001 — De-duplicate seed lessons accidentally inserted twice
-- =============================================================================
-- Background:
--   Whilst building the demo data, the Sophie / Oliver / Jamie / Amelia seed
--   lessons were inserted more than once on 2026-05-27 (and possibly other
--   dates), producing identical rows (same instructor + same student + same
--   start_time + same end_time + same topic) that only differ by id and
--   created_at.
--
-- Strategy:
--   1. PREVIEW first (read-only). Copy the SELECT into Supabase SQL Editor,
--      run it, eyeball the output. If you are happy that those rows really
--      are duplicates, run the DELETE.
--   2. The DELETE keeps the OLDEST row of each duplicate cluster (lowest
--      created_at) so any FKs that already point at a row remain intact.
--   3. Idempotent — re-running after a clean DB is a no-op.
--
-- Safety:
--   * Scoped to status = 'Scheduled' only. Will NOT touch completed or
--     cancelled lessons (those carry real money/audit data).
--   * Cluster key: (instructor_id, student_id, start_time, end_time, topic).
--     Two rows must match on ALL five columns to be considered duplicates.
--   * Caps the affected date range to 2026-05-26..2026-05-29 so a stray
--     bug in the cluster predicate cannot wipe out unrelated future lessons.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — PREVIEW (read-only). Run this first.
-- -----------------------------------------------------------------------------
with ranked as (
    select
        id,
        student_id,
        instructor_id,
        start_time,
        end_time,
        topic,
        status,
        created_at,
        row_number() over (
            partition by instructor_id, student_id, start_time, end_time, topic
            order by created_at asc, id asc
        ) as rn,
        count(*) over (
            partition by instructor_id, student_id, start_time, end_time, topic
        ) as cluster_size
    from public.lessons
    where status = 'Scheduled'
      and start_time >= '2026-05-26T00:00:00+00:00'
      and start_time <  '2026-05-30T00:00:00+00:00'
)
select
    id,
    student_id,
    instructor_id,
    start_time,
    end_time,
    topic,
    rn,
    cluster_size,
    case when rn = 1 then 'KEEP' else 'DELETE' end as action
from ranked
where cluster_size > 1
order by start_time, student_id, rn;


-- -----------------------------------------------------------------------------
-- STEP 2 — DELETE. Only run this once you are happy with the preview output.
-- -----------------------------------------------------------------------------
-- (Wrap in a transaction so you can ROLLBACK if anything looks off.)
-- begin;
--
-- with ranked as (
--     select
--         id,
--         row_number() over (
--             partition by instructor_id, student_id, start_time, end_time, topic
--             order by created_at asc, id asc
--         ) as rn
--     from public.lessons
--     where status = 'Scheduled'
--       and start_time >= '2026-05-26T00:00:00+00:00'
--       and start_time <  '2026-05-30T00:00:00+00:00'
-- )
-- delete from public.lessons
-- where id in (select id from ranked where rn > 1);
--
-- -- Verify a sensible row-count before committing.
-- -- commit;
-- =============================================================================
