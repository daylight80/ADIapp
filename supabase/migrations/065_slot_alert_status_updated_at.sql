-- slot_alert_status() also returns when the lesson was last changed, so the app can tell a
-- cancellation that is just about to be announced from an old one that never will be.
create or replace function public.slot_alert_status(p_lesson_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp
as $f$
declare l record;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select les.id, les.instructor_id, les.slot_alert_sent_at, les.updated_at, i.school_id into l
    from public.lessons les join public.instructors i on i.id = les.instructor_id where les.id = p_lesson_id;
  if not found then return null; end if;
  if l.instructor_id is distinct from public.current_user_instructor_id() and not public.is_school_owner(l.school_id) then
    return null; -- not this caller's lesson: say nothing
  end if;
  return jsonb_build_object('sent_at', l.slot_alert_sent_at,
                            'lesson_updated_at', l.updated_at,
                            'told', (select count(*) from public.slot_alert_log where lesson_id = p_lesson_id));
end $f$;
