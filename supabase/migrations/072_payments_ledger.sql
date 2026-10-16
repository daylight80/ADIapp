-- Payment tracking, phase 1: a ledger of money received from each pupil.
--
--   payments            one row per payment (cash, bank transfer, card, voucher, other), with date, optional
--                       reference and note. Mistakes are voided (kept, marked, and no longer counted), never deleted.
--   record_payment()    how an instructor (or the school owner) adds one. Takes an optional id so a retry can't
--                       record it twice. Pupils can't write payments.
--   void_payment()      marks a payment void with an optional reason.
--   my_payment_summary() what a pupil sees: charged, paid, balance, their payments and wallet top-ups.
--   students_with_balance  now charges minus payments minus wallet top-ups (charges: a completed lesson's agreed
--                       price, or hours x rate when none was agreed, plus any cancellation charge).
--
-- The lesson-completion screen still just saves "amount paid" and the method on the lesson. A trigger turns that
-- into a payment row (and removes it again if the amount is cleared or the lesson is no longer completed), so
-- nothing about completing a lesson changes for the instructor, and the offline queue keeps working.
-- Existing completed lessons with an amount were copied across as 'migrated' payments.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.driving_schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  recorded_by uuid references public.instructors(id) on delete set null,
  lesson_id uuid references public.lessons(id) on delete set null,
  amount numeric(10,2) not null check (amount > 0 and amount <= 10000),
  method text not null check (method in ('cash','bank_transfer','card','voucher','other')),
  paid_at timestamptz not null default now(),
  reference text check (reference is null or char_length(reference) <= 80),
  note text check (note is null or char_length(note) <= 300),
  source text not null default 'manual' check (source in ('manual','lesson','migrated')),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_student on public.payments(student_id, paid_at desc);
create index if not exists idx_payments_school on public.payments(school_id, paid_at desc);
create unique index if not exists ux_payments_lesson_derived on public.payments(lesson_id) where source in ('lesson','migrated');

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at before update on public.payments for each row execute function public.set_updated_at();

alter table public.payments enable row level security;

drop policy if exists payments_instructor_read on public.payments;
create policy payments_instructor_read on public.payments for select
  using (exists (select 1 from public.students s where s.id = payments.student_id and s.instructor_id = public.current_user_instructor_id()));
drop policy if exists payments_owner_read on public.payments;
create policy payments_owner_read on public.payments for select using (public.is_school_owner(school_id));
drop policy if exists payments_self_read on public.payments;
create policy payments_self_read on public.payments for select
  using (voided_at is null and exists (select 1 from public.students s where s.id = payments.student_id and s.auth_user_id = auth.uid()));
-- No insert/update/delete policies: writes go through the functions below and the lesson trigger.

create or replace function public.sync_lesson_payment() returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
declare sch uuid;
begin
  if new.status = 'Completed' and coalesce(new.amount_paid, 0) > 0 then
    select s.school_id into sch from public.students s where s.id = new.student_id;
    insert into public.payments (school_id, student_id, recorded_by, lesson_id, amount, method, paid_at, note, source)
      values (sch, new.student_id, new.instructor_id, new.id, new.amount_paid, coalesce(new.payment_method, 'other'), coalesce(new.start_time, now()), 'From the lesson', 'lesson')
    on conflict (lesson_id) where source in ('lesson','migrated')
      do update set amount = excluded.amount, method = excluded.method, paid_at = excluded.paid_at;
  else
    delete from public.payments where lesson_id = new.id and source in ('lesson','migrated');
  end if;
  return new;
end $f$;
revoke execute on function public.sync_lesson_payment() from public, anon, authenticated;

drop trigger if exists trg_lessons_sync_payment on public.lessons;
create trigger trg_lessons_sync_payment after insert or update of status, amount_paid, payment_method, start_time on public.lessons
  for each row execute function public.sync_lesson_payment();

insert into public.payments (school_id, student_id, recorded_by, lesson_id, amount, method, paid_at, note, source)
  select s.school_id, l.student_id, l.instructor_id, l.id, l.amount_paid, coalesce(l.payment_method, 'other'), l.start_time, 'From the lesson', 'migrated'
  from public.lessons l join public.students s on s.id = l.student_id
  where l.status = 'Completed' and coalesce(l.amount_paid, 0) > 0
  on conflict do nothing;

create or replace view public.students_with_balance with (security_invoker = true) as
  select s.id as student_id, s.school_id, s.instructor_id,
         coalesce(ch.total, 0) - coalesce(pay.total, 0) - coalesce(bl.total, 0) as outstanding_gbp,
         coalesce(ch.total, 0) as charged_gbp,
         coalesce(pay.total, 0) + coalesce(bl.total, 0) as paid_gbp
    from public.students s
    left join lateral (select sum(case when l.status = 'Completed' then coalesce(l.quoted_amount, coalesce(l.duration_hours, 0) * coalesce(s.hourly_rate, 0))
                                       when l.status = 'Cancelled' then coalesce(l.cancellation_charge, 0) else 0 end) as total
                         from public.lessons l where l.student_id = s.id) ch on true
    left join lateral (select sum(p.amount) as total from public.payments p where p.student_id = s.id and p.voided_at is null) pay on true
    left join lateral (select sum(b.amount) as total from public.block_bookings b where b.student_id = s.id) bl on true;

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
  if p_id is not null then select * into row from public.payments where id = p_id; if found then return to_jsonb(row); end if; end if;
  if p_lesson_id is not null and not exists (select 1 from public.lessons l where l.id = p_lesson_id and l.student_id = p_student_id) then
    raise exception 'That lesson does not belong to this pupil.' using errcode = '22023'; end if;
  insert into public.payments (id, school_id, student_id, recorded_by, lesson_id, amount, method, paid_at, reference, note, source)
    values (coalesce(p_id, gen_random_uuid()), stu.school_id, stu.id, public.current_user_instructor_id(), p_lesson_id, round(p_amount, 2), p_method, coalesce(p_paid_at, now()), nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), 'manual')
    returning * into row;
  return to_jsonb(row);
end $f$;

create or replace function public.void_payment(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare row public.payments%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select p.* into row from public.payments p join public.students s on s.id = p.student_id
   where p.id = p_id and (s.instructor_id = public.current_user_instructor_id() or public.is_school_owner(s.school_id));
  if row.id is null then raise exception 'Payment not found.' using errcode = 'P0002'; end if;
  if row.voided_at is null then
    update public.payments set voided_at = now(), void_reason = nullif(btrim(p_reason), '') where id = row.id returning * into row;
  end if;
  return to_jsonb(row);
end $f$;

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
                            from public.payments p where p.student_id = sid and p.voided_at is null), '[]'::jsonb),
    'topups', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'amount', k.amount, 'hours', k.hours_paid, 'at', k.purchased_at, 'method', k.payment_method) order by k.purchased_at desc)
                          from public.block_bookings k where k.student_id = sid), '[]'::jsonb));
end $f$;

revoke execute on function public.record_payment(uuid, numeric, text, timestamptz, text, text, uuid, uuid), public.void_payment(uuid, text), public.my_payment_summary() from public, anon;
grant execute on function public.record_payment(uuid, numeric, text, timestamptz, text, text, uuid, uuid), public.void_payment(uuid, text), public.my_payment_summary() to authenticated, service_role;
