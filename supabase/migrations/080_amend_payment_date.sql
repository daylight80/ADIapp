-- Let an instructor (or the school owner) change the date a payment was received, for when it was entered late or
-- on the wrong day. Only the date moves: the amount and method stay as recorded, and a mistake in those is still
-- fixed by voiding and re-recording.
--   original_paid_at / date_changed_at   kept the first time the date is changed, so the change can be traced
--   update_payment_date()                the only way to change it; refuses voided payments and dates in the future
-- A payment that came from completing a lesson normally follows the lesson's date. Once its date has been
-- changed by hand it keeps that date, even if the lesson is edited afterwards.
alter table public.payments
  add column if not exists original_paid_at timestamptz,
  add column if not exists date_changed_at timestamptz;

create or replace function public.sync_lesson_payment() returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
declare sch uuid;
begin
  if new.status = 'Completed' and coalesce(new.amount_paid, 0) > 0 then
    select s.school_id into sch from public.students s where s.id = new.student_id;
    insert into public.payments (school_id, student_id, recorded_by, lesson_id, amount, method, paid_at, note, source)
      values (sch, new.student_id, new.instructor_id, new.id, new.amount_paid, coalesce(new.payment_method, 'other'), coalesce(new.start_time, now()), 'From the lesson', 'lesson')
    on conflict (lesson_id) where source in ('lesson','migrated')
      do update set amount = excluded.amount, method = excluded.method,
                    paid_at = case when public.payments.date_changed_at is not null then public.payments.paid_at else excluded.paid_at end;
  else
    delete from public.payments where lesson_id = new.id and source in ('lesson','migrated');
  end if;
  return new;
end $f$;
revoke execute on function public.sync_lesson_payment() from public, anon, authenticated;

create or replace function public.update_payment_date(p_id uuid, p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare row public.payments%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select p.* into row from public.payments p join public.students s on s.id = p.student_id
   where p.id = p_id and (s.instructor_id = public.current_user_instructor_id() or public.is_school_owner(s.school_id));
  if row.id is null then raise exception 'Payment not found.' using errcode = 'P0002'; end if;
  if row.voided_at is not null then raise exception 'A voided payment can''t be changed.' using errcode = '22023'; end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' then raise exception 'The payment date can''t be in the future.' using errcode = '22023'; end if;
  if p_paid_at < timestamptz '2020-01-01' then raise exception 'That date is too far back.' using errcode = '22023'; end if;
  update public.payments
     set paid_at = p_paid_at,
         original_paid_at = coalesce(original_paid_at, row.paid_at),
         date_changed_at = now()
   where id = row.id returning * into row;
  return to_jsonb(row);
end $f$;

revoke execute on function public.update_payment_date(uuid, timestamptz) from public, anon;
grant execute on function public.update_payment_date(uuid, timestamptz) to authenticated, service_role;
