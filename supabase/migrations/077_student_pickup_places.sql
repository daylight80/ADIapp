-- Extra pickup places for a pupil (college, work, a relative's house). The pupil's main pickup address stays on
-- students.address / students.postcode (the default, used by reminders and navigation); this table holds the
-- others. A lesson picks one by copying its address into lessons.pickup_address, which the diary, navigation
-- and travel times already use.
-- All access is through the functions below (the table has RLS on and no direct policies), because a pupil
-- has no direct write access to their own rows. Allowed: the pupil themselves, their instructor, or the
-- school owner.
create table if not exists public.student_places (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  label      text not null check (char_length(btrim(label)) between 1 and 40),
  address    text not null check (char_length(btrim(address)) between 1 and 200),
  postcode   text check (postcode is null or char_length(postcode) <= 10),
  created_at timestamptz not null default now()
);
create index if not exists student_places_student_idx on public.student_places (student_id);
alter table public.student_places enable row level security;
revoke all on public.student_places from anon, authenticated;

create or replace function public._can_manage_student_places(p_student_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $f$ select exists (select 1 from public.students s where s.id = p_student_id and auth.uid() is not null
           and (s.auth_user_id = auth.uid() or s.instructor_id = public.current_user_instructor_id() or public.is_school_owner(s.school_id))) $f$;

-- p_student_id null means "my own" (the signed-in pupil).
create or replace function public.list_student_places(p_student_id uuid default null) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp
  as $f$ declare sid uuid := p_student_id; begin
   if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
   if sid is null then select id into sid from public.students where auth_user_id = auth.uid() limit 1; end if;
   if sid is null or not public._can_manage_student_places(sid) then return '[]'::jsonb; end if;
   return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'student_id', p.student_id, 'label', p.label, 'address', p.address, 'postcode', p.postcode) order by p.created_at)
                    from public.student_places p where p.student_id = sid), '[]'::jsonb);
  end $f$;

create or replace function public.save_student_place(p_label text, p_address text, p_postcode text default null, p_student_id uuid default null, p_id uuid default null) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp
  as $f$ declare sid uuid := p_student_id; lab text := btrim(coalesce(p_label, '')); adr text := btrim(coalesce(p_address, '')); pc text := nullif(upper(btrim(coalesce(p_postcode, ''))), ''); row public.student_places%rowtype; begin
   if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
   if sid is null then select id into sid from public.students where auth_user_id = auth.uid() limit 1; end if;
   if sid is null or not public._can_manage_student_places(sid) then raise exception 'You cannot change this pupil''s pickup places.' using errcode = '42501'; end if;
   if char_length(lab) not between 1 and 40 then raise exception 'Give the place a short name, e.g. College.' using errcode = '22023'; end if;
   if char_length(adr) not between 1 and 200 then raise exception 'Enter the address.' using errcode = '22023'; end if;
   if pc is not null and char_length(pc) > 10 then raise exception 'Postcode is too long' using errcode = '22023'; end if;
   if p_id is null then
     if (select count(*) from public.student_places where student_id = sid) >= 6 then raise exception 'You can save up to 6 extra pickup places.' using errcode = '22023'; end if;
     insert into public.student_places (student_id, label, address, postcode) values (sid, lab, adr, pc) returning * into row;
   else
     update public.student_places set label = lab, address = adr, postcode = pc where id = p_id and student_id = sid returning * into row;
     if row.id is null then raise exception 'Place not found.' using errcode = 'P0002'; end if;
   end if;
   return to_jsonb(row);
  end $f$;

create or replace function public.delete_student_place(p_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp
  as $f$ declare sid uuid; begin
   if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
   select student_id into sid from public.student_places where id = p_id;
   if sid is null or not public._can_manage_student_places(sid) then raise exception 'You cannot change this pupil''s pickup places.' using errcode = '42501'; end if;
   delete from public.student_places where id = p_id;
  end $f$;

revoke execute on function public._can_manage_student_places(uuid), public.list_student_places(uuid), public.save_student_place(text, text, text, uuid, uuid), public.delete_student_place(uuid) from public, anon;
grant execute on function public.list_student_places(uuid), public.save_student_place(text, text, text, uuid, uuid), public.delete_student_place(uuid) to authenticated, service_role;
