-- A pupil redeems a gift voucher themselves by entering its code. One database step does it all, so a
-- code can't be used twice: it checks the code (the pupil's own school only, active, not cancelled,
-- in date), adds the hours to the pupil's wallet as a block booking, and marks the voucher redeemed.
--
-- The wallet amount is hours x the pupil's hourly rate, the same as when an instructor tops up by hand,
-- because the app counts a block's amount as payment received (the voucher was paid for when it was
-- bought). block_bookings.gift_voucher_id links the hours to the voucher and is unique, so the same
-- voucher can never add hours twice. Wrong, other-school and malformed codes all get the same message.
alter table public.block_bookings add column if not exists gift_voucher_id uuid unique references public.gift_vouchers(id) on delete set null;
alter table public.gift_vouchers add column if not exists redeemed_by_student_id uuid references public.students(id) on delete set null;

create or replace function public.redeem_gift_voucher(p_code text)
returns table(voucher_hours numeric, new_balance numeric)
language plpgsql security definer set search_path = public, pg_temp
as $f$
declare
  raw text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
  norm text;
  stu record;
  v public.gift_vouchers%rowtype;
  total numeric;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if char_length(raw) <> 12 then raise exception 'That code is not recognised. Check it and try again.' using errcode = 'P0002'; end if;
  norm := substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4);
  select s.id, s.school_id, s.hourly_rate into stu from public.students s where s.auth_user_id = auth.uid() limit 1;
  if stu.id is null then raise exception 'No student record is linked to this account' using errcode = 'P0002'; end if;
  select * into v from public.gift_vouchers g where g.code = norm and g.school_id = stu.school_id for update;
  if not found then raise exception 'That code is not recognised. Check it and try again.' using errcode = 'P0002'; end if;
  if v.status = 'redeemed' then raise exception 'This voucher has already been used.' using errcode = 'P0001'; end if;
  if v.status = 'cancelled' then raise exception 'This voucher has been cancelled. Please contact your instructor.' using errcode = 'P0001'; end if;
  if v.expires_at < (now() at time zone 'Europe/London')::date then raise exception 'This voucher has expired. Please contact your instructor.' using errcode = 'P0001'; end if;
  insert into public.block_bookings (student_id, hours_paid, amount, notes, gift_voucher_id)
    values (stu.id, v.hours, round(v.hours * coalesce(stu.hourly_rate, 0), 2), 'Gift voucher ' || v.code, v.id);
  update public.gift_vouchers set status = 'redeemed', redeemed_at = now(), redeemed_by_student_id = stu.id where id = v.id;
  select coalesce(sum(b.hours_paid - b.hours_used), 0) into total from public.block_bookings b where b.student_id = stu.id;
  return query select v.hours, total;
end $f$;

revoke execute on function public.redeem_gift_voucher(text) from public, anon;
grant execute on function public.redeem_gift_voucher(text) to authenticated, service_role;
