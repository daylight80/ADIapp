-- =============================================================================
-- Migration 010 — Instructor pricing: default_hourly_rate + lesson_packages
-- =============================================================================
-- 1. Each instructor has their own default hourly rate (new students inherit
--    it; can be overridden per student).
-- 2. Lesson packages replace today's hard-coded BLOCK_OPTIONS. Each package
--    has: name, hours, price (nullable until the instructor sets it),
--    description, optional topic_tag, active flag.
-- 3. When a new instructor is created, 8 default packages are seeded with
--    NULL prices so the owner just fills in their numbers.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add default_hourly_rate to instructors
-- ---------------------------------------------------------------------------
alter table public.instructors
    add column if not exists default_hourly_rate numeric(6,2) not null default 36.00;

-- ---------------------------------------------------------------------------
-- 2. lesson_packages
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_packages (
    id              uuid primary key default gen_random_uuid(),
    school_id       uuid not null references public.driving_schools(id) on delete cascade,
    instructor_id   uuid not null references public.instructors(id) on delete cascade,
    name            text not null,
    hours           numeric(5,2) not null check (hours > 0),
    price           numeric(8,2) check (price is null or price >= 0),
    description     text,
    topic_tag       text,            -- e.g. 'Motorway', 'Pass Plus', null
    active          boolean not null default true,
    sort_order      int not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_lesson_packages_instructor
    on public.lesson_packages(instructor_id, active, sort_order);

alter table public.lesson_packages enable row level security;

-- Owner can manage all packages in their school; sub-instructors can manage
-- only their own packages.
drop policy if exists pkg_owner_all on public.lesson_packages;
create policy pkg_owner_all on public.lesson_packages
    for all
    using (
        exists (
            select 1 from public.driving_schools s
            where s.id = lesson_packages.school_id and s.owner_auth_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.driving_schools s
            where s.id = lesson_packages.school_id and s.owner_auth_id = auth.uid()
        )
    );

drop policy if exists pkg_instructor_own on public.lesson_packages;
create policy pkg_instructor_own on public.lesson_packages
    for all
    using (
        exists (
            select 1 from public.instructors i
            where i.id = lesson_packages.instructor_id and i.auth_user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.instructors i
            where i.id = lesson_packages.instructor_id and i.auth_user_id = auth.uid()
        )
    );

-- Students assigned to an instructor in this school can READ active packages
-- (so the wallet block-booking sheet can render purchasable options).
drop policy if exists pkg_student_read on public.lesson_packages;
create policy pkg_student_read on public.lesson_packages
    for select
    using (
        active = true
        and exists (
            select 1 from public.students st
            where st.school_id = lesson_packages.school_id
              and st.auth_user_id = auth.uid()
        )
    );

-- updated_at trigger
create or replace function public.set_lesson_packages_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lesson_packages_updated_at on public.lesson_packages;
create trigger trg_lesson_packages_updated_at
    before update on public.lesson_packages
    for each row execute function public.set_lesson_packages_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Seed default packages for every existing instructor (idempotent)
-- ---------------------------------------------------------------------------
do $$
declare
    ins record;
    defaults jsonb := '[
      {"name": "Single lesson",      "hours": 1,   "topic_tag": null,         "description": "One-off driving lesson",                         "sort_order": 10},
      {"name": "5-hour block",       "hours": 5,   "topic_tag": null,         "description": "Five-hour block booking",                        "sort_order": 20},
      {"name": "10-hour block",      "hours": 10,  "topic_tag": null,         "description": "Ten-hour block booking",                         "sort_order": 30},
      {"name": "20-hour block",      "hours": 20,  "topic_tag": null,         "description": "Twenty-hour block booking",                      "sort_order": 40},
      {"name": "Pass Plus",          "hours": 6,   "topic_tag": "Pass Plus",  "description": "Six-hour Pass Plus course",                      "sort_order": 50},
      {"name": "Refresher",          "hours": 2,   "topic_tag": "Refresher",  "description": "Refresher driving lesson",                       "sort_order": 60},
      {"name": "Motorway",           "hours": 2,   "topic_tag": "Motorway",   "description": "Motorway lesson",                                "sort_order": 70},
      {"name": "Test Day Fee",       "hours": 2.5, "topic_tag": "Test Day",   "description": "Test-day support including pre-test warm-up",    "sort_order": 80}
    ]'::jsonb;
    d jsonb;
begin
    for ins in select id, school_id from public.instructors loop
        for d in select * from jsonb_array_elements(defaults) loop
            insert into public.lesson_packages
                (school_id, instructor_id, name, hours, price, description, topic_tag, active, sort_order)
            select ins.school_id, ins.id,
                   d->>'name',
                   (d->>'hours')::numeric,
                   null,                         -- price intentionally blank
                   d->>'description',
                   nullif(d->>'topic_tag','null'),
                   true,
                   (d->>'sort_order')::int
            where not exists (
                select 1 from public.lesson_packages p
                where p.instructor_id = ins.id and p.name = (d->>'name')
            );
        end loop;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Auto-seed defaults for any NEW instructor
-- ---------------------------------------------------------------------------
create or replace function public.seed_lesson_packages_for_new_instructor()
returns trigger as $$
declare
    defaults jsonb := '[
      {"name": "Single lesson",      "hours": 1,   "topic_tag": null,         "description": "One-off driving lesson",                      "sort_order": 10},
      {"name": "5-hour block",       "hours": 5,   "topic_tag": null,         "description": "Five-hour block booking",                     "sort_order": 20},
      {"name": "10-hour block",      "hours": 10,  "topic_tag": null,         "description": "Ten-hour block booking",                      "sort_order": 30},
      {"name": "20-hour block",      "hours": 20,  "topic_tag": null,         "description": "Twenty-hour block booking",                   "sort_order": 40},
      {"name": "Pass Plus",          "hours": 6,   "topic_tag": "Pass Plus",  "description": "Six-hour Pass Plus course",                   "sort_order": 50},
      {"name": "Refresher",          "hours": 2,   "topic_tag": "Refresher",  "description": "Refresher driving lesson",                    "sort_order": 60},
      {"name": "Motorway",           "hours": 2,   "topic_tag": "Motorway",   "description": "Motorway lesson",                             "sort_order": 70},
      {"name": "Test Day Fee",       "hours": 2.5, "topic_tag": "Test Day",   "description": "Test-day support including pre-test warm-up", "sort_order": 80}
    ]'::jsonb;
    d jsonb;
begin
    for d in select * from jsonb_array_elements(defaults) loop
        insert into public.lesson_packages
            (school_id, instructor_id, name, hours, price, description, topic_tag, active, sort_order)
        values (
            new.school_id, new.id,
            d->>'name',
            (d->>'hours')::numeric,
            null,
            d->>'description',
            nullif(d->>'topic_tag','null'),
            true,
            (d->>'sort_order')::int
        )
        on conflict do nothing;
    end loop;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_seed_packages_new_instructor on public.instructors;
create trigger trg_seed_packages_new_instructor
    after insert on public.instructors
    for each row execute function public.seed_lesson_packages_for_new_instructor();

-- =============================================================================
-- DONE.
-- =============================================================================
