-- ============================================================================
-- Migration 022 — Per-student outstanding-balance view ("arrears")
-- ============================================================================
-- Instructors do NOT take Stripe for individual lessons. Payments are tracked
-- entirely in the database via `lessons.amount_paid` (per-lesson money in)
-- and `block_bookings.amount` (lump-sum pre-payments). This view computes
-- each student's net outstanding balance so the dashboard can surface a
-- "Students in arrears" tile and the Students CRM screen can filter by it.
--
-- Definition (matches user spec "D" — sum of A + B + C):
--   outstanding_gbp =
--       Σ (lesson.duration_hours × student.hourly_rate − COALESCE(lesson.amount_paid, 0))
--           for Completed lessons
--     − Σ (block_bookings.amount)
--           for that student (treats every block as a credit on file)
--
-- Sign convention: POSITIVE means the student owes money; ZERO or NEGATIVE
-- means they are up to date (or in credit). The dashboard tile counts only
-- rows where outstanding_gbp > 0.
--
-- Security: declared with `security_invoker = true` so the existing RLS on
-- `students`, `lessons`, and `block_bookings` is enforced for the caller.
-- An owner sees their entire school, an instructor sees only their pupils,
-- and a learner cannot see any other learner's balance.
-- ============================================================================

create or replace view public.students_with_balance
    with (security_invoker = true)
as
select
    s.id              as student_id,
    s.school_id,
    s.instructor_id,
    coalesce(lessons_owed.total, 0)
        - coalesce(blocks_credit.total, 0)
                      as outstanding_gbp
from public.students s
-- Σ unpaid value across Completed lessons
left join lateral (
    select sum(
               coalesce(l.duration_hours, 0) * coalesce(s.hourly_rate, 0)
               - coalesce(l.amount_paid, 0)
           ) as total
    from public.lessons l
    where l.student_id = s.id
      and l.status     = 'Completed'
) lessons_owed on true
-- Σ block-booking credit on file (treated as money already received)
left join lateral (
    select sum(b.amount) as total
    from public.block_bookings b
    where b.student_id = s.id
) blocks_credit on true;

comment on view public.students_with_balance is
    'Per-student net outstanding balance in GBP. Positive = owes money. '
    'Honours base-table RLS via security_invoker.';
