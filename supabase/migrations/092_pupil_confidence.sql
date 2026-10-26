-- ============================================================================
-- Migration 092 — Pupil confidence rating after a lesson
-- ============================================================================
-- After a lesson the pupil rates how confident they felt, 1 (not at all) to 5 (very). The instructor sees it on the
-- pupil's driving profile, next to their own assessment.
--
--   lessons.pupil_confidence     1 to 5, null until the pupil rates it
--   lessons.pupil_confidence_at  when they rated it
--   rate_lesson_confidence()     the only way a pupil writes it. Pupils have no update rights on lessons, so this
--                                SECURITY DEFINER function checks the caller owns the pupil record on that lesson,
--                                the lesson is Completed, and the score is 1 to 5. It touches nothing else.
-- ============================================================================

alter table public.lessons
  add column if not exists pupil_confidence smallint check (pupil_confidence between 1 and 5),
  add column if not exists pupil_confidence_at timestamptz;

create or replace function public.rate_lesson_confidence(p_lesson_id uuid, p_score int)
returns void language plpgsql security definer set search_path = public, pg_temp as $f$
declare l record;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_score is null or p_score < 1 or p_score > 5 then raise exception 'Choose a score from 1 to 5.' using errcode = '22023'; end if;
  select le.id, le.status into l from public.lessons le
    join public.students s on s.id = le.student_id
   where le.id = p_lesson_id and s.auth_user_id = auth.uid();
  if l.id is null then raise exception 'Lesson not found.' using errcode = 'P0002'; end if;
  if l.status <> 'Completed' then raise exception 'You can rate a lesson once it has finished.' using errcode = '22023'; end if;
  update public.lessons set pupil_confidence = p_score, pupil_confidence_at = now() where id = p_lesson_id;
end $f$;

revoke execute on function public.rate_lesson_confidence(uuid, int) from public, anon;
grant execute on function public.rate_lesson_confidence(uuid, int) to authenticated, service_role;
