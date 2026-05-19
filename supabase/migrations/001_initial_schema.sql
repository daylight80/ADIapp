-- =============================================================================
-- ADI Pro — UK Driving School CRM
-- Initial schema migration (PostgreSQL / Supabase)
-- =============================================================================
-- This migration creates:
--   • 6 core tables (driving_schools, instructors, vehicles, students,
--     lessons, dvsa_syllabus_tracking)
--   • All foreign-key relationships
--   • Row Level Security with two effective roles:
--       1. School owner — full access to every record belonging to their school
--       2. Instructor   — read-only access to records they are assigned to,
--                         write access to their own lessons & DVSA tracking
--
-- NOTE: To enforce RLS for instructors we need to link each instructor row to
--       a Supabase auth user. We add an `auth_user_id UUID` column on
--       `instructors` (matches `auth.users(id)`). School owners are identified
--       via `driving_schools.owner_auth_id` as specified.
-- =============================================================================

-- Required extensions ---------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive text (postcode etc.)

-- =============================================================================
-- 1. driving_schools
-- =============================================================================
create table if not exists public.driving_schools (
    id                  uuid primary key default gen_random_uuid(),
    business_name       text not null,
    owner_auth_id       uuid not null references auth.users(id) on delete cascade,
    subscription_status text not null default 'free'
        check (subscription_status in ('free', 'active', 'past_due', 'cancelled', 'trialing')),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists idx_driving_schools_owner on public.driving_schools(owner_auth_id);

-- =============================================================================
-- 2. instructors
-- =============================================================================
create table if not exists public.instructors (
    id            uuid primary key default gen_random_uuid(),
    school_id     uuid not null references public.driving_schools(id) on delete cascade,
    auth_user_id  uuid unique references auth.users(id) on delete set null,
    full_name     text not null,
    adi_number    text not null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint instructors_adi_unique_per_school unique (school_id, adi_number)
);

create index if not exists idx_instructors_school on public.instructors(school_id);
create index if not exists idx_instructors_auth   on public.instructors(auth_user_id);

-- =============================================================================
-- 3. vehicles (UK / right-hand drive)
-- =============================================================================
create table if not exists public.vehicles (
    id                  uuid primary key default gen_random_uuid(),
    school_id           uuid not null references public.driving_schools(id) on delete cascade,
    make_and_model      text not null,
    registration_plate  text not null,
    transmission        text not null
        check (transmission in ('Manual', 'Automatic', 'Electric')),
    is_right_hand_drive boolean not null default true,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    constraint vehicles_uk_only check (is_right_hand_drive = true),
    constraint vehicles_plate_unique_per_school unique (school_id, registration_plate)
);

create index if not exists idx_vehicles_school on public.vehicles(school_id);

-- =============================================================================
-- 4. students
-- =============================================================================
create table if not exists public.students (
    id                   uuid primary key default gen_random_uuid(),
    school_id            uuid not null references public.driving_schools(id) on delete cascade,
    instructor_id        uuid not null references public.instructors(id)     on delete restrict,
    full_name            text not null,
    provisional_licence  text not null,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

create index if not exists idx_students_school     on public.students(school_id);
create index if not exists idx_students_instructor on public.students(instructor_id);

-- =============================================================================
-- 5. lessons
-- =============================================================================
create table if not exists public.lessons (
    id            uuid primary key default gen_random_uuid(),
    student_id    uuid not null references public.students(id)    on delete cascade,
    instructor_id uuid not null references public.instructors(id) on delete restrict,
    vehicle_id    uuid not null references public.vehicles(id)    on delete restrict,
    start_time    timestamptz not null,
    end_time      timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists idx_lessons_student    on public.lessons(student_id);
create index if not exists idx_lessons_instructor on public.lessons(instructor_id);
create index if not exists idx_lessons_vehicle    on public.lessons(vehicle_id);
create index if not exists idx_lessons_start_time on public.lessons(start_time);

-- =============================================================================
-- 6. dvsa_syllabus_tracking
-- =============================================================================
create table if not exists public.dvsa_syllabus_tracking (
    id                uuid primary key default gen_random_uuid(),
    student_id        uuid not null references public.students(id) on delete cascade,
    manoeuvre         text not null,
    competency_level  integer not null
        check (competency_level between 1 and 5),
    notes             text,
    assessed_at       timestamptz not null default now(),
    assessed_by       uuid references public.instructors(id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint dvsa_unique_manoeuvre_per_student unique (student_id, manoeuvre)
);

create index if not exists idx_dvsa_student on public.dvsa_syllabus_tracking(student_id);

-- =============================================================================
-- updated_at trigger (shared)
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
declare
    t text;
begin
    foreach t in array array[
        'driving_schools',
        'instructors',
        'vehicles',
        'students',
        'lessons',
        'dvsa_syllabus_tracking'
    ]
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
-- RLS — helper functions (SECURITY DEFINER so they bypass RLS internally)
-- =============================================================================

-- Returns the set of driving_school ids owned by the current auth user.
create or replace function public.current_user_school_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select id from public.driving_schools where owner_auth_id = auth.uid()
$$;

-- Returns the instructor record for the current auth user (or NULL).
create or replace function public.current_user_instructor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select id from public.instructors where auth_user_id = auth.uid() limit 1
$$;

-- Returns the school_id of the instructor row for the current auth user.
create or replace function public.current_user_instructor_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select school_id from public.instructors where auth_user_id = auth.uid() limit 1
$$;

-- Is the current auth user a school owner of <school>?
create or replace function public.is_school_owner(school uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.driving_schools
        where id = school and owner_auth_id = auth.uid()
    )
$$;

grant execute on function public.current_user_school_ids()              to authenticated;
grant execute on function public.current_user_instructor_id()           to authenticated;
grant execute on function public.current_user_instructor_school_id()    to authenticated;
grant execute on function public.is_school_owner(uuid)                  to authenticated;

-- =============================================================================
-- Enable RLS on every table
-- =============================================================================
alter table public.driving_schools          enable row level security;
alter table public.instructors              enable row level security;
alter table public.vehicles                 enable row level security;
alter table public.students                 enable row level security;
alter table public.lessons                  enable row level security;
alter table public.dvsa_syllabus_tracking   enable row level security;

-- =============================================================================
-- POLICIES — driving_schools
--   Owner: full CRUD on rows they own
--   Instructor: SELECT only the school they belong to
-- =============================================================================
drop policy if exists ds_owner_all       on public.driving_schools;
drop policy if exists ds_instructor_read on public.driving_schools;

create policy ds_owner_all on public.driving_schools
    for all
    using (owner_auth_id = auth.uid())
    with check (owner_auth_id = auth.uid());

create policy ds_instructor_read on public.driving_schools
    for select
    using (id = public.current_user_instructor_school_id());

-- =============================================================================
-- POLICIES — instructors
--   Owner: full CRUD over instructors of their school
--   Instructor: SELECT own row + colleagues at the same school (read-only)
-- =============================================================================
drop policy if exists ins_owner_all       on public.instructors;
drop policy if exists ins_instructor_read on public.instructors;

create policy ins_owner_all on public.instructors
    for all
    using (public.is_school_owner(school_id))
    with check (public.is_school_owner(school_id));

create policy ins_instructor_read on public.instructors
    for select
    using (school_id = public.current_user_instructor_school_id());

-- =============================================================================
-- POLICIES — vehicles
--   Owner: full CRUD on their school's vehicles
--   Instructor: SELECT vehicles at their school (needed to assign a lesson)
-- =============================================================================
drop policy if exists veh_owner_all       on public.vehicles;
drop policy if exists veh_instructor_read on public.vehicles;

create policy veh_owner_all on public.vehicles
    for all
    using (public.is_school_owner(school_id))
    with check (public.is_school_owner(school_id));

create policy veh_instructor_read on public.vehicles
    for select
    using (school_id = public.current_user_instructor_school_id());

-- =============================================================================
-- POLICIES — students
--   Owner: full CRUD on all students of their school
--   Instructor: SELECT/UPDATE only their assigned students
-- =============================================================================
drop policy if exists stu_owner_all          on public.students;
drop policy if exists stu_instructor_select  on public.students;
drop policy if exists stu_instructor_update  on public.students;

create policy stu_owner_all on public.students
    for all
    using (public.is_school_owner(school_id))
    with check (public.is_school_owner(school_id));

create policy stu_instructor_select on public.students
    for select
    using (instructor_id = public.current_user_instructor_id());

-- Instructors may UPDATE notes / progress on their own students (but cannot
-- reassign them — instructor_id must remain themselves).
create policy stu_instructor_update on public.students
    for update
    using (instructor_id = public.current_user_instructor_id())
    with check (instructor_id = public.current_user_instructor_id());

-- =============================================================================
-- POLICIES — lessons
--   Owner: full CRUD on every lesson at their school
--   Instructor: full CRUD only on lessons they teach
-- =============================================================================
drop policy if exists les_owner_all       on public.lessons;
drop policy if exists les_instructor_all  on public.lessons;

create policy les_owner_all on public.lessons
    for all
    using (
        exists (
            select 1
            from public.students s
            where s.id = lessons.student_id
              and public.is_school_owner(s.school_id)
        )
    )
    with check (
        exists (
            select 1
            from public.students s
            where s.id = lessons.student_id
              and public.is_school_owner(s.school_id)
        )
    );

create policy les_instructor_all on public.lessons
    for all
    using (instructor_id = public.current_user_instructor_id())
    with check (instructor_id = public.current_user_instructor_id());

-- =============================================================================
-- POLICIES — dvsa_syllabus_tracking
--   Owner: full CRUD on tracking rows for students of their school
--   Instructor: full CRUD on tracking rows of their assigned students
-- =============================================================================
drop policy if exists dvsa_owner_all      on public.dvsa_syllabus_tracking;
drop policy if exists dvsa_instructor_all on public.dvsa_syllabus_tracking;

create policy dvsa_owner_all on public.dvsa_syllabus_tracking
    for all
    using (
        exists (
            select 1 from public.students s
            where s.id = dvsa_syllabus_tracking.student_id
              and public.is_school_owner(s.school_id)
        )
    )
    with check (
        exists (
            select 1 from public.students s
            where s.id = dvsa_syllabus_tracking.student_id
              and public.is_school_owner(s.school_id)
        )
    );

create policy dvsa_instructor_all on public.dvsa_syllabus_tracking
    for all
    using (
        exists (
            select 1 from public.students s
            where s.id = dvsa_syllabus_tracking.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    )
    with check (
        exists (
            select 1 from public.students s
            where s.id = dvsa_syllabus_tracking.student_id
              and s.instructor_id = public.current_user_instructor_id()
        )
    );

-- =============================================================================
-- Grants (Supabase auto-grants to authenticated/anon — keep explicit too)
-- =============================================================================
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- =============================================================================
-- End of migration 001
-- =============================================================================
