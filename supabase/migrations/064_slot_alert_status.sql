-- Lets an instructor see what happened to the slot alert for one of their cancelled lessons:
-- when the backend handled it and how many pupils were told. slot_alert_log is readable only by
-- the backend, so this is a function that answers only for the caller's own lessons (or, for a
-- school owner, the school's) and returns null for anyone else's.
create or replace function public.slot_alert_status(p_lesson_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp
as $f$
declare l record;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select les.id, les.instructor_id, les.slot_alert_sent_at, i.school_id into l
    from public.lessons les join public.instructors i on i.id = les.instructor_id where les.id = p_lesson_id;
  if not found then return null; end if;
  if l.instructor_id is distinct from public.current_user_instructor_id() and not public.is_school_owner(l.school_id) then
    return null; -- not this caller's lesson: say nothing
  end if;
  return jsonb_build_object('sent_at', l.slot_alert_sent_at,
                            'told', (select count(*) from public.slot_alert_log where lesson_id = p_lesson_id));
end $f$;
revoke execute on function public.slot_alert_status(uuid) from public, anon;
grant execute on function public.slot_alert_status(uuid) to authenticated, service_role;
