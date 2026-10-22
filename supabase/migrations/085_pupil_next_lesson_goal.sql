-- The goal for a pupil's next lesson. The instructor's lesson notes are private (the pupil can't read the table), but
-- the answer to the "Goal for next lesson" question is meant for the pupil to see on their next lesson.
--
--   my_next_lesson_goal()   For the signed-in pupil: the goal written in the most recent lesson notes before their next
--                           booked lesson, with the dates of both. Only the goal answer is returned: nothing else
--                           from the notes (what needs more practice, what went well) ever leaves the table.
--                           Null when there is no next lesson or no goal.
-- Only goals written in the 28 days before the next lesson count. The goal question is found by its wording ("goal").

create or replace function public.my_next_lesson_goal() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare sid uuid; nxt timestamptz; r record;
begin
  select s.id into sid from public.students s where s.auth_user_id = auth.uid() limit 1;
  if sid is null then return null; end if;

  select min(l.start_time) into nxt
    from public.lessons l
   where l.student_id = sid and l.status = 'Scheduled' and l.start_time > now();
  if nxt is null then return null; end if;

  select n.answers ->> q.id::text as goal, l.start_time as from_time
    into r
    from public.instructor_lesson_notes n
    join public.lessons l on l.id = n.lesson_id
    join public.lesson_note_questions q on q.instructor_id = n.instructor_id and q.question_text ilike '%goal%'
   where n.student_id = sid
     and l.start_time < nxt
     and l.start_time > nxt - interval '28 days'   -- an old goal isn't this lesson's goal
     and coalesce(btrim(n.answers ->> q.id::text), '') <> ''
   order by l.start_time desc
   limit 1;
  if r.goal is null then return null; end if;

  return jsonb_build_object('goal', left(btrim(r.goal), 500), 'from_lesson', r.from_time, 'next_lesson', nxt);
end $f$;

revoke execute on function public.my_next_lesson_goal() from public, anon;
grant execute on function public.my_next_lesson_goal() to authenticated, service_role;
