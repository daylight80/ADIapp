-- ============================================================================
-- Migration 088 — A lesson paid from prepaid hours is not paid for twice
-- ============================================================================
-- The balance view counted every payment AND every prepaid block's amount as money received. When a lesson draws
-- its hours from a prepaid block and the instructor also records a payment on that lesson (the amount paid box on
-- Complete lesson, which a trigger turns into a 'lesson' payment), the same money was counted twice: a real case showed
-- 2 prepaid hours bought for £80 plus an £80 payment on the lesson, so Paid read £160.
--
-- Rule: a lesson-completion payment is not counted again when prepaid hours fully cover that lesson (the hours the
-- lesson drew from blocks, in block_booking_usage, reach its length). The prepaid block's own amount is the money.
-- A lesson only part-covered by prepaid hours keeps its payment (the rest was genuinely paid on the day), and manual
-- payments are never touched. Nothing is rewritten: the rule is applied when the balance is worked out, so it follows
-- a lesson being completed, un-completed or changed.
--
--   payment_covered_by_prepaid(payment_id)   true for such a payment. SECURITY DEFINER because
--                                            block_booking_usage is internal (no client policies); it answers only
--                                            yes or no for a payment id.
--   students_with_balance                    Paid no longer includes covered payments.
--   payment_prepaid_cover                    which of a pupil's payments are covered, so the app can say so.
--   my_payment_summary()                     the pupil's own list leaves covered payments out, like the total.
-- Idempotent.
-- ============================================================================

create or replace function public.payment_covered_by_prepaid(p_payment_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $f$
  select coalesce((
    select p.source in ('lesson', 'migrated')
       and p.lesson_id is not null
       and coalesce(l.duration_hours, 0) > 0
       and coalesce((select sum(u.hours) from public.block_booking_usage u where u.lesson_id = l.id), 0) >= round(l.duration_hours, 2)
      from public.payments p
      join public.lessons l on l.id = p.lesson_id
     where p.id = p_payment_id
  ), false)
$f$;

revoke execute on function public.payment_covered_by_prepaid(uuid) from public, anon;
grant execute on function public.payment_covered_by_prepaid(uuid) to authenticated, service_role;

create or replace view public.students_with_balance with (security_invoker = true) as
  select s.id as student_id, s.school_id, s.instructor_id,
         coalesce(ch.total, 0) - coalesce(pay.total, 0) - coalesce(bl.total, 0) as outstanding_gbp,
         coalesce(ch.total, 0) as charged_gbp,
         coalesce(pay.total, 0) + coalesce(bl.total, 0) as paid_gbp
    from public.students s
    left join lateral (select sum(case when l.status = 'Completed' then coalesce(l.quoted_amount, coalesce(l.duration_hours, 0) * coalesce(s.hourly_rate, 0))
                                       when l.status = 'Cancelled' then coalesce(l.cancellation_charge, 0) else 0 end) as total
                         from public.lessons l where l.student_id = s.id) ch on true
    left join lateral (select sum(p.amount) as total from public.payments p
                        where p.student_id = s.id and p.voided_at is null and not public.payment_covered_by_prepaid(p.id)) pay on true
    left join lateral (select sum(b.amount) as total from public.block_bookings b where b.student_id = s.id) bl on true;

create or replace view public.payment_prepaid_cover with (security_invoker = true) as
  select p.id as payment_id, p.student_id
    from public.payments p
   where p.voided_at is null and public.payment_covered_by_prepaid(p.id);

create or replace function public.my_payment_summary() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare sid uuid; b record;
begin
  select s.id into sid from public.students s where s.auth_user_id = auth.uid() limit 1;
  if sid is null then return null; end if;
  select v.charged_gbp, v.paid_gbp, v.outstanding_gbp into b from public.students_with_balance v where v.student_id = sid;
  return jsonb_build_object(
    'charged', coalesce(b.charged_gbp, 0), 'paid', coalesce(b.paid_gbp, 0), 'balance', coalesce(b.outstanding_gbp, 0),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'method', p.method, 'paid_at', p.paid_at, 'reference', p.reference) order by p.paid_at desc)
                            from public.payments p
                           where p.student_id = sid and p.voided_at is null and not public.payment_covered_by_prepaid(p.id)), '[]'::jsonb),
    'topups', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'amount', k.amount, 'hours', k.hours_paid, 'at', k.purchased_at, 'method', k.payment_method) order by k.purchased_at desc)
                          from public.block_bookings k where k.student_id = sid), '[]'::jsonb));
end $f$;

revoke execute on function public.my_payment_summary() from public, anon;
grant execute on function public.my_payment_summary() to authenticated, service_role;
