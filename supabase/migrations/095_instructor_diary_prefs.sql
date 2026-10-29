-- An instructor's own Add Lesson choices, kept in one JSON column and read and set through functions that only
-- touch the caller's own row (same pattern as 071 and 076: the table's update policy is owner-only).
--   lesson_lengths: [{ "minutes": 90, "price": 55 }, ...]  the length chips, each with an optional total price
--   lesson_types:   ["Standard", "Night", ...]             the lesson types offered (null/absent = all of them)
--   work_start / work_end: "HH:MM"                         when "next available slots" may be offered
-- Anything absent means "use the app's defaults", so existing instructors see no change until they set something.
alter table public.instructors add column if not exists diary_prefs jsonb not null default '{}'::jsonb;

create or replace function public.get_my_diary_prefs() returns jsonb
  language sql stable security definer set search_path = public, pg_temp
  as $f$ select coalesce((select i.diary_prefs from public.instructors i where i.auth_user_id = auth.uid() limit 1), '{}'::jsonb) $f$;

create or replace function public.set_my_diary_prefs(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp
  as $f$
  declare
    clean jsonb := '{}'::jsonb;
    el jsonb;
    m numeric;
    pr jsonb;
    lengths jsonb := '[]'::jsonb;
    ws text; we text;
  begin
   if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
   if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Settings must be an object' using errcode = '22023'; end if;

   if p ? 'lesson_lengths' then
     if jsonb_typeof(p->'lesson_lengths') <> 'array' or jsonb_array_length(p->'lesson_lengths') > 8 then
       raise exception 'Lesson lengths: up to 8' using errcode = '22023';
     end if;
     for el in select * from jsonb_array_elements(p->'lesson_lengths') loop
       if jsonb_typeof(el->'minutes') <> 'number' then raise exception 'Each length needs minutes' using errcode = '22023'; end if;
       m := (el->>'minutes')::numeric;
       if m <> trunc(m) or m < 15 or m > 480 then raise exception 'A lesson length must be 15 to 480 whole minutes' using errcode = '22023'; end if;
       pr := el->'price';
       if pr is not null and jsonb_typeof(pr) = 'number' then
         if (pr#>>'{}')::numeric < 0 or (pr#>>'{}')::numeric > 1000 then raise exception 'A lesson price must be 0 to 1000' using errcode = '22023'; end if;
         lengths := lengths || jsonb_build_array(jsonb_build_object('minutes', m::int, 'price', pr));
       else
         lengths := lengths || jsonb_build_array(jsonb_build_object('minutes', m::int, 'price', null));
       end if;
     end loop;
     clean := clean || jsonb_build_object('lesson_lengths', lengths);
   end if;

   if p ? 'lesson_types' then
     if jsonb_typeof(p->'lesson_types') = 'array' then
       if jsonb_array_length(p->'lesson_types') > 20 then raise exception 'Too many lesson types' using errcode = '22023'; end if;
       if exists (select 1 from jsonb_array_elements(p->'lesson_types') t where jsonb_typeof(t) <> 'string' or length(t#>>'{}') > 40) then
         raise exception 'Lesson types must be short text' using errcode = '22023';
       end if;
       clean := clean || jsonb_build_object('lesson_types', p->'lesson_types');
     elsif jsonb_typeof(p->'lesson_types') <> 'null' then
       raise exception 'Lesson types must be a list' using errcode = '22023';
     end if;
   end if;

   if p ? 'work_start' or p ? 'work_end' then
     ws := coalesce(p->>'work_start', '08:00'); we := coalesce(p->>'work_end', '18:00');
     if ws !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or we !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or ws >= we then
       raise exception 'Working hours need a start before the end, as HH:MM' using errcode = '22023';
     end if;
     clean := clean || jsonb_build_object('work_start', ws, 'work_end', we);
   end if;

   -- merge: only the keys sent change; the rest stay as they were
   update public.instructors set diary_prefs = diary_prefs || clean where auth_user_id = auth.uid();
   return (select diary_prefs from public.instructors where auth_user_id = auth.uid() limit 1);
  end $f$;

revoke execute on function public.get_my_diary_prefs(), public.set_my_diary_prefs(jsonb) from public, anon;
grant execute on function public.get_my_diary_prefs(), public.set_my_diary_prefs(jsonb) to authenticated, service_role;
