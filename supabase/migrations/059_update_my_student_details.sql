-- Lets a pupil keep their own contact details up to date: mobile number, pickup address,
-- postcode and provisional licence number. Pupils have no UPDATE policy on students and
-- should not get one (they could then change their own rate or status), so this is a narrow
-- function that changes only these four fields on the caller's own row. Email stays
-- instructor-controlled because it is how a pupil's login is linked to their record.
-- A null argument leaves that field unchanged.
create or replace function public.update_my_student_details(
  p_phone text default null, p_address text default null, p_postcode text default null, p_licence text default null
) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp
as $f$
declare sid uuid; lic text; ph text; adr text; pc text; res jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select id into sid from public.students where auth_user_id = auth.uid() limit 1;
  if sid is null then raise exception 'No student record is linked to this login' using errcode = 'P0002'; end if;
  if p_phone is not null then
    ph := btrim(p_phone);
    if ph !~ '^[0-9+() -]{6,20}$' then raise exception 'Enter a valid mobile number' using errcode = '22023'; end if;
  end if;
  if p_address is not null then
    adr := btrim(p_address);
    if char_length(adr) > 200 then raise exception 'Address is too long' using errcode = '22023'; end if;
  end if;
  if p_postcode is not null then
    pc := upper(btrim(p_postcode));
    if char_length(pc) > 10 then raise exception 'Postcode is too long' using errcode = '22023'; end if;
  end if;
  if p_licence is not null then
    lic := upper(regexp_replace(p_licence, '\s+', '', 'g'));
    if lic !~ '^[A-Z0-9]{16}$' then raise exception 'Provisional licence number must be 16 letters and numbers' using errcode = '22023'; end if;
  end if;
  update public.students set
    phone = coalesce(ph, phone), address = coalesce(adr, address),
    postcode = coalesce(pc, postcode), provisional_licence = coalesce(lic, provisional_licence)
  where id = sid
  returning jsonb_build_object('phone', phone, 'address', address, 'postcode', postcode, 'provisional_licence', provisional_licence) into res;
  return res;
end $f$;
revoke execute on function public.update_my_student_details(text, text, text, text) from public, anon;
grant execute on function public.update_my_student_details(text, text, text, text) to authenticated, service_role;
