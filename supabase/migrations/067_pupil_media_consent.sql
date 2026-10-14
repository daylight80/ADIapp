-- Optional consent for the pupil's pass photo/video to be used on social media and the school's website.
-- Separate from the Pupil Agreement signature: optional, can be changed or withdrawn at any time,
-- and the date of the last change is kept. Pupils can't update students directly, so it goes through RPCs.
alter table public.students add column if not exists media_consent boolean not null default false;
alter table public.students add column if not exists media_consent_at timestamptz;

create or replace function public.set_my_media_consent(p_consent boolean) returns boolean
  language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode='28000'; end if;
  update public.students set media_consent = coalesce(p_consent,false), media_consent_at = now() where auth_user_id = auth.uid();
  return coalesce(p_consent,false);
end $f$;

create or replace function public.get_my_media_consent() returns boolean
  language sql security definer stable set search_path = public, pg_temp as $f$
  select coalesce((select media_consent from public.students where auth_user_id = auth.uid() limit 1), false) $f$;

revoke execute on function public.set_my_media_consent(boolean), public.get_my_media_consent() from public, anon;
grant execute on function public.set_my_media_consent(boolean), public.get_my_media_consent() to authenticated, service_role;
