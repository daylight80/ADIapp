-- =============================================================================
-- Migration 013 — Instructor availability blocks (a.k.a. "Unavailabilities")
-- =============================================================================
-- Lets an instructor mark windows of time when they are unavailable (e.g.
-- holidays, school runs, dentist appointments). The Diary renders these as
-- grey diagonal-striped bands, and the "Add Lesson" save flow hard-blocks
-- when the proposed slot overlaps an existing block. Owners can also see all
-- blocks for instructors in their school for resource planning.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.availability_blocks (
    id              uuid primary key default gen_random_uuid(),
    instructor_id   uuid not null references public.instructors(id) on delete cascade,
    school_id       uuid references public.driving_schools(id) on delete set null,
    starts_at       timestamptz not null,
    ends_at         timestamptz not null,
    all_day         boolean not null default false,
    category        text not null default 'other'
                    check (category in ('holiday','personal','family','sick','other')),
    reason          text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint chk_block_range check (ends_at > starts_at)
);

create index if not exists idx_avail_blocks_instructor_range
    on public.availability_blocks (instructor_id, starts_at, ends_at);

create index if not exists idx_avail_blocks_school
    on public.availability_blocks (school_id, starts_at)
    where school_id is not null;

-- Auto-touch updated_at on PATCH (consistent with other tables in this schema).
do $$
begin
    if not exists (
        select 1 from pg_proc where proname = 'set_updated_at_timestamp'
    ) then
        create or replace function public.set_updated_at_timestamp()
        returns trigger as $body$
        begin
            new.updated_at = now();
            return new;
        end;
        $body$ language plpgsql;
    end if;
end$$;

drop trigger if exists trg_avail_blocks_updated_at on public.availability_blocks;
create trigger trg_avail_blocks_updated_at
    before update on public.availability_blocks
    for each row execute function public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.availability_blocks enable row level security;

-- Instructors manage (read/write/delete) their own blocks.
drop policy if exists "avail_blocks_instructor_self" on public.availability_blocks;
create policy "avail_blocks_instructor_self"
    on public.availability_blocks
    for all
    using (
        instructor_id in (
            select id from public.instructors where auth_user_id = auth.uid()
        )
    )
    with check (
        instructor_id in (
            select id from public.instructors where auth_user_id = auth.uid()
        )
    );

-- Owners can read all blocks for instructors in their school.
drop policy if exists "avail_blocks_owner_read" on public.availability_blocks;
create policy "avail_blocks_owner_read"
    on public.availability_blocks
    for select
    using (
        school_id in (
            select id from public.driving_schools where owner_auth_id = auth.uid()
        )
    );

-- =============================================================================
-- DONE.
-- =============================================================================
