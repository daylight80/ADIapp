-- Passing the in-app theory practice test awards the "Theory Champion" badge, which is one of
-- the five driving-readiness criteria. The app tried to insert the badge itself, but pupils have
-- no INSERT policy on badges_earned (only instructors and school owners write badges), so the
-- insert was refused: the pupil was told "Badge unlocked" and the readiness criterion could
-- never be met (found 14 Oct 2026). This function awards just that one badge, for the
-- caller's own student record, once.
create or replace function public.award_my_theory_badge() returns void
  language plpgsql security definer set search_path = public, pg_temp
as $f$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select id into sid from public.students where auth_user_id = auth.uid() limit 1;
  if sid is null then raise exception 'No student record is linked to this login' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.badges_earned where student_id = sid and badge_key = 'theory_passed') then
    insert into public.badges_earned (student_id, badge_key, badge_name, description)
    values (sid, 'theory_passed', 'Theory Champion', 'Passed an in-app theory test');
  end if;
end $f$;
revoke execute on function public.award_my_theory_badge() from public, anon;
grant execute on function public.award_my_theory_badge() to authenticated, service_role;
