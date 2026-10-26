-- ============================================================================
-- Migration 091 — record_payment: a retry only finds the same pupil's payment, and two retries cannot collide
-- ============================================================================
-- record_payment takes an optional id so a retry cannot record the payment twice. Two problems with how it looked
-- the id up (it runs as SECURITY DEFINER, so row security does not help):
--   1. It looked the id up across ALL payments. An instructor who passed the id of a payment belonging to another
--      pupil, or another school, was handed that whole payment row back, and nothing was recorded.
--   2. Two retries arriving together both missed the lookup, and the second failed with a raw duplicate-key error.
-- Now the lookup is scoped to the pupil being paid, the insert tolerates the id already existing, and an id that
-- belongs to someone else's payment is refused without revealing anything about it.
-- ============================================================================

create or replace function public.record_payment(p_student_id uuid, p_amount numeric, p_method text, p_paid_at timestamptz default null, p_reference text default null, p_note text default null, p_id uuid default null, p_lesson_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $f$
declare stu record; row public.payments%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select s.id, s.school_id, s.instructor_id into stu from public.students s
   where s.id = p_student_id and (s.instructor_id = public.current_user_instructor_id() or public.is_school_owner(s.school_id));
  if stu.id is null then raise exception 'You can only record payments for your own pupils.' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000 then raise exception 'Enter an amount between £0.01 and £10,000.' using errcode = '22023'; end if;
  if p_method is null or p_method not in ('cash','bank_transfer','card','voucher','other') then raise exception 'Choose how it was paid.' using errcode = '22023'; end if;
  if p_id is not null then
    select * into row from public.payments where id = p_id and student_id = p_student_id;
    if found then return to_jsonb(row); end if;
  end if;
  if p_lesson_id is not null and not exists (select 1 from public.lessons l where l.id = p_lesson_id and l.student_id = p_student_id) then
    raise exception 'That lesson does not belong to this pupil.' using errcode = '22023'; end if;
  insert into public.payments (id, school_id, student_id, recorded_by, lesson_id, amount, method, paid_at, reference, note, source)
    values (coalesce(p_id, gen_random_uuid()), stu.school_id, stu.id, public.current_user_instructor_id(), p_lesson_id, round(p_amount, 2), p_method, coalesce(p_paid_at, now()), nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), 'manual')
    on conflict (id) do nothing
    returning * into row;
  if row.id is null then
    -- The id already exists: either a retry landed between our lookup and insert (same pupil: return it), or it
    -- belongs to another pupil's payment (refuse, and say nothing about that payment).
    select * into row from public.payments where id = p_id and student_id = p_student_id;
    if not found then raise exception 'That payment id is already in use.' using errcode = '23505'; end if;
  end if;
  return to_jsonb(row);
end $f$;
