-- =============================================================================
-- Migration 007 — Smart Gap waiting list + Expo push tokens
-- =============================================================================
-- Adds two tables to support real "Broadcast the gap" fan-out to learners:
--
--   • public.waiting_list   — students opt in to be notified when a slot
--                              opens up at their school.
--   • public.push_tokens    — one row per device per auth user, used to
--                              dispatch real Expo Push notifications from
--                              the backend.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. waiting_list
-- ---------------------------------------------------------------------------
create table if not exists public.waiting_list (
    id          uuid primary key default gen_random_uuid(),
    school_id   uuid not null references public.driving_schools(id) on delete cascade,
    student_id  uuid not null references public.students(id) on delete cascade,
    active      boolean not null default true,
    notes       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- A student should only have one waiting-list row per school.
create unique index if not exists ux_waiting_list_school_student
    on public.waiting_list(school_id, student_id);

create index if not exists idx_waiting_list_school_active
    on public.waiting_list(school_id, active);

alter table public.waiting_list enable row level security;

-- Instructors (owner) see and manage all rows in their school.
drop policy if exists waiting_list_owner_all on public.waiting_list;
create policy waiting_list_owner_all on public.waiting_list
    for all
    using (
        exists (
            select 1 from public.driving_schools s
            where s.id = waiting_list.school_id and s.owner_auth_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.driving_schools s
            where s.id = waiting_list.school_id and s.owner_auth_id = auth.uid()
        )
    );

-- A learner can read/update/insert/delete their own waiting-list row.
drop policy if exists waiting_list_self_all on public.waiting_list;
create policy waiting_list_self_all on public.waiting_list
    for all
    using (
        exists (
            select 1 from public.students st
            where st.id = waiting_list.student_id and st.auth_user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.students st
            where st.id = waiting_list.student_id and st.auth_user_id = auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- 2. push_tokens
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
    id            uuid primary key default gen_random_uuid(),
    auth_user_id  uuid not null references auth.users(id) on delete cascade,
    expo_token    text not null,
    platform      text,
    device_label  text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- One row per (user, token) — re-issuing the same token from the same device
-- is a no-op via on-conflict-do-update on the client side.
create unique index if not exists ux_push_tokens_user_token
    on public.push_tokens(auth_user_id, expo_token);

create index if not exists idx_push_tokens_user
    on public.push_tokens(auth_user_id);

alter table public.push_tokens enable row level security;

-- Users manage their own push tokens; backend (service role) ignores RLS.
drop policy if exists push_tokens_self_all on public.push_tokens;
create policy push_tokens_self_all on public.push_tokens
    for all
    using (auth.uid() = auth_user_id)
    with check (auth.uid() = auth_user_id);

-- =============================================================================
-- DONE.
-- =============================================================================
