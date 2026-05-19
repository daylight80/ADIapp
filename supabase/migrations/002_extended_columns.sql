-- =============================================================================
-- ADI Pro — 002 Extended columns + auxiliary tables
-- =============================================================================
-- Run AFTER 001_initial_schema.sql.
-- Adds all the additional fields the current Expo UI relies on (CRM contact
-- details, lesson billing, competency progress, badges, reflective logs,
-- block bookings) without breaking the original spec.
--
-- Every operation is idempotent (`if not exists`, `drop … if exists`) so the
-- file can be re-run safely.
-- =============================================================================

-- =============================================================================
-- 1. students — add contact, billing & lifecycle fields
-- =============================================================================
alter table public.students
    add column if not exists email          citext,
    add column if not exists phone          text,
    add column if not exists address        text,
    add column if not exists postcode       text,
    add column if not exists status         text not null default 'New',
    add column if not exists progress       int  not null default 0,
    add column if not exists lessons_count  int  not null default 0,
    add column if not exists next_lesson    timestamptz,
    add column if not exists test_date      timestamptz,
    add column if not exists test_passed_at timestamptz,
    add column if not exists hourly_rate    numeric(6,2) not null default 36.00,
    add column if not exists avatar         text,
    add column if not exists joined_at      timestamptz not null default now();

do $$ begin
    alter table public.students
        add constraint students_status_chk
        check (status in ('New', 'Active', 'Test Ready', 'Passed'));
exception when duplicate_object then null; end $$;

do $$ begin
    alter table public.students
        add constraint students_progress_chk
        check (progress between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
    alter table public.students
        add constraint students_email_unique_per_school unique (school_id, email);
exception when duplicate_object then null; end $$;

create index if not exists idx_students_status   on public.students(status);
create index if not exists idx_students_test_date on public.students(test_date);

-- =============================================================================
-- 2. lessons — add scheduling, billing & DVSA fault counters
-- =============================================================================
alter table public.lessons
    add column if not exists topic                  text,
    add column if not exists duration_hours         numeric(4,2),
    add column if not exists travel_minutes         int,
    add column if not exists pickup_address         text,
    add column if not exists driving_faults         int  not null default 0,
    add column if not exists serious_faults         int  not null default 0,
    add column if not exists dangerous_faults       int  not null default 0,
    add column if not exists grade                  int,
    add column if not exists amount_paid            numeric(8,2),
    add column if not exists notes                  text,
    add column if not exists pre_check_completed_at timestamptz,
    add column if not exists status                 text not null default 'Scheduled';

do $$ begin
    alter table public.lessons
        add constraint lessons_status_chk
        check (status in ('Scheduled', 'Completed', 'Cancelled'));
exception when duplicate_object then null; end $$;

do $$ begin
    alter table public.lessons
        add constraint lessons_grade_chk check (grade is null or grade between 1 and 5);
exception when duplicate_object then null; end $$;

do $$ begin
    alter table public.lessons
        add constraint lessons_faults_nonneg
        check (driving_faults >= 0 and serious_faults >= 0 and dangerous_faults >= 0);
exception when duplicate_object then null; end $$;

create index if not exists idx_lessons_status on public.lessons(status);
create index if not exists idx_lessons_date_status on public.lessons(start_time, status);

-- =============================================================================
-- 3. dvsa_syllabus_tracking — richer competency display fields
-- =============================================================================
alter table public.dvsa_syllabus_tracking
    add column if not exists category_key  text,
    add column if not exists category_name text,
    add column if not exists progress      int not null default 0;

do $$ begin
    alter table public.dvsa_syllabus_tracking
        add constraint dvsa_progress_chk check (progress between 0 and 100);
exception when duplicate_object then null; end $$;

create index if not exists idx_dvsa_category on public.dvsa_syllabus_tracking(category_key);

-- =============================================================================
-- 4. block_bookings — pre-paid lesson packages
-- =============================================================================
create table if not exists public.block_bookings (
    id           uuid primary key default gen_random_uuid(),
    student_id   uuid not null references public.students(id) on delete cascade,
    hours_paid   numeric(5,2) not null check (hours_paid > 0),
    hours_used   numeric(5,2) not null default 0 check (hours_used >= 0),
    amount       numeric(8,2) not null check (amount >= 0),
    purchased_at timestamptz not null default now(),
    notes        text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists idx_block_bookings_student on public.block_bookings(student_id);

-- =============================================================================
-- 5. reflective_logs — student's own post-lesson reflection
-- =============================================================================
create table if not exists public.reflective_logs (
    id             uuid primary key default gen_random_uuid(),
    student_id     uuid not null references public.students(id) on delete cascade,
    lesson_id      uuid references public.lessons(id) on delete set null,
    what_well      text,
    what_difficult text,
    next_focus     text,
    created_at     timestamptz not null default now()
);

create index if not exists idx_reflective_logs_student on public.reflective_logs(student_id);

-- =============================================================================
-- 6. badges_earned — gamification ribbons
-- =============================================================================
create table if not exists public.badges_earned (
    id          uuid primary key default gen_random_uuid(),
    student_id  uuid not null references public.students(id) on delete cascade,
    badge_key   text not null,
    badge_name  text not null,
    description text,
    earned_at   timestamptz not null default now(),
    constraint badges_one_per_student unique (student_id, badge_key)
);

create index if not exists idx_badges_student on public.badges_earned(student_id);

-- =============================================================================
-- 7. updated_at triggers on the new tables
-- =============================================================================
do $$
declare t text;
begin
    foreach t in array array['block_bookings'] -- only the table that has updated_at
    loop
        execute format(
            'drop trigger if exists trg_%1$s_updated_at on public.%1$s;
             create trigger trg_%1$s_updated_at
             before update on public.%1$s
             for each row execute function public.set_updated_at();',
            t
        );
    end loop;
end $$;

-- =============================================================================
-- 8. RLS on the new tables (mirror the lessons / dvsa pattern)
-- =============================================================================
alter table public.block_bookings  enable row level security;
alter table public.reflective_logs enable row level security;
alter table public.badges_earned   enable row level security;

-- block_bookings -------------------------------------------------------------
drop policy if exists bb_owner_all      on public.block_bookings;
drop policy if exists bb_instructor_all on public.block_bookings;

create policy bb_owner_all on public.block_bookings
    for all
    using (
        exists (
            select 1 from public.students s
            where s.id = block_bookings.student_id
              and public.is_school_owner(s.school_id)
        )
    )
    with check (
        exists (
            select 1 from public.students s
            where s.id = block_bookings.student_id
              and public.is_school_owner(s.school_id)
        )
    );

create policy bb_instructor_all on public.block_bookings
    for all
    using (
        exists (
            select 1 from public.students s
            where s.id = block_bookings.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    )
    with check (
        exists (
            select 1 from public.students s
            where s.id = block_bookings.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    );

-- reflective_logs ------------------------------------------------------------
drop policy if exists rl_owner_all      on public.reflective_logs;
drop policy if exists rl_instructor_all on public.reflective_logs;

create policy rl_owner_all on public.reflective_logs
    for all
    using (
        exists (
            select 1 from public.students s
            where s.id = reflective_logs.student_id
              and public.is_school_owner(s.school_id)
        )
    )
    with check (
        exists (
            select 1 from public.students s
            where s.id = reflective_logs.student_id
              and public.is_school_owner(s.school_id)
        )
    );

create policy rl_instructor_all on public.reflective_logs
    for all
    using (
        exists (
            select 1 from public.students s
            where s.id = reflective_logs.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    )
    with check (
        exists (
            select 1 from public.students s
            where s.id = reflective_logs.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    );

-- badges_earned --------------------------------------------------------------
drop policy if exists be_owner_all      on public.badges_earned;
drop policy if exists be_instructor_all on public.badges_earned;

create policy be_owner_all on public.badges_earned
    for all
    using (
        exists (
            select 1 from public.students s
            where s.id = badges_earned.student_id
              and public.is_school_owner(s.school_id)
        )
    )
    with check (
        exists (
            select 1 from public.students s
            where s.id = badges_earned.student_id
              and public.is_school_owner(s.school_id)
        )
    );

create policy be_instructor_all on public.badges_earned
    for all
    using (
        exists (
            select 1 from public.students s
            where s.id = badges_earned.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    )
    with check (
        exists (
            select 1 from public.students s
            where s.id = badges_earned.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    );

-- =============================================================================
-- 9. Lesson auto-housekeeping (denormalised counters)
--    Keeps students.lessons_count in sync when lessons are inserted/deleted/
--    moved to Completed.
-- =============================================================================
create or replace function public.recount_student_lessons()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    sid uuid;
begin
    if tg_op = 'DELETE' then sid := old.student_id; else sid := new.student_id; end if;

    update public.students s
    set lessons_count = (
        select count(*) from public.lessons l
        where l.student_id = sid and l.status = 'Completed'
    )
    where s.id = sid;

    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_lessons_recount on public.lessons;
create trigger trg_lessons_recount
after insert or update of status or delete on public.lessons
for each row execute function public.recount_student_lessons();

-- =============================================================================
-- End of migration 002
-- =============================================================================
