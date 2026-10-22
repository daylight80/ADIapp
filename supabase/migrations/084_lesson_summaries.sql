-- Dictated lesson summaries: after a lesson the instructor dictates a few sentences, the backend drafts a short
-- encouraging summary and a suggested plan for the next lesson, the instructor edits and approves it, and it is
-- saved here for the pupil to read. Only the approved text is kept (the dictation itself is not stored).
--
--   lesson_summaries    one row per lesson. Written only by the backend (service role): there are no insert,
--                       update or delete policies. The lesson's instructor and the school owner can read it.
--   my_lesson_summaries()  what a pupil sees: their own approved summaries, newest first, with the lesson's date
--                       and topic and the instructor's first name. Nothing else about the lesson is exposed.

create table if not exists public.lesson_summaries (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  school_id uuid references public.driving_schools(id) on delete cascade,
  instructor_id uuid references public.instructors(id) on delete set null,
  summary text not null check (char_length(btrim(summary)) between 1 and 1500),
  next_plan text check (next_plan is null or char_length(next_plan) <= 1000),
  approved_at timestamptz not null default now(),
  notified_at timestamptz,
  notified_channel text check (notified_channel is null or notified_channel in ('push', 'email')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lesson_summaries_student on public.lesson_summaries(student_id, approved_at desc);

drop trigger if exists trg_lesson_summaries_updated_at on public.lesson_summaries;
create trigger trg_lesson_summaries_updated_at before update on public.lesson_summaries
  for each row execute function public.set_updated_at();

alter table public.lesson_summaries enable row level security;

drop policy if exists lesson_summaries_instructor_read on public.lesson_summaries;
create policy lesson_summaries_instructor_read on public.lesson_summaries for select
  using (instructor_id = public.current_user_instructor_id());
drop policy if exists lesson_summaries_owner_read on public.lesson_summaries;
create policy lesson_summaries_owner_read on public.lesson_summaries for select
  using (school_id is not null and public.is_school_owner(school_id));

create or replace function public.my_lesson_summaries() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $f$
declare sid uuid;
begin
  select s.id into sid from public.students s where s.auth_user_id = auth.uid() limit 1;
  if sid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'lesson_id', x.lesson_id, 'summary', x.summary, 'next_plan', x.next_plan,
             'approved_at', x.approved_at, 'lesson_date', x.start_time, 'topic', x.topic,
             'instructor_first_name', x.first_name) order by x.approved_at desc)
      from (
        select ls.id, ls.lesson_id, ls.summary, ls.next_plan, ls.approved_at, l.start_time, l.topic,
               split_part(coalesce(i.full_name, ''), ' ', 1) as first_name
          from public.lesson_summaries ls
          join public.lessons l on l.id = ls.lesson_id
          left join public.instructors i on i.id = ls.instructor_id
         where ls.student_id = sid
         order by ls.approved_at desc
         limit 50
      ) x
  ), '[]'::jsonb);
end $f$;

revoke execute on function public.my_lesson_summaries() from public, anon;
grant execute on function public.my_lesson_summaries() to authenticated, service_role;
