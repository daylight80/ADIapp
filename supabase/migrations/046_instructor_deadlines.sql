-- =============================================================================
-- Migration 046 — Instructor deadline tracking + reminder log
-- =============================================================================
-- Every instructor has renewal dates they can't afford to miss: ADI badge, MOT,
-- insurance, road tax, dual-control service. Nothing in ADI Pro tracked them
-- (MOT and insurance existed only as expense categories). This adds a small
-- table for them and a daily reminder job (backend/admin_reminders.py) that
-- emails and pushes the instructor at 30, 7 and 1 days before, and once if it
-- goes overdue. Paid plans only (enforced in the app and in the job).
--
-- The DVSA standards check is NOT stored here: it is re-derived from the
-- instructor's existing adi_standards_checks log (last check + 4 years, the
-- same rule the Standards Check screen already uses), so nobody types the same
-- date twice. The view below presents both kinds as one list, so the app and the
-- reminder job read a single source of truth.
--
-- First version is per-instructor only (a solo instructor's own car is their
-- own deadline). School owners are deliberately NOT given read access to their
-- instructors' deadlines yet; fleet-vehicle tracking for Franchise schools is a
-- separate later step.
--
-- Additive and idempotent. Safe to apply before the code that uses it.
-- =============================================================================

create table if not exists public.instructor_deadlines (
    id            uuid primary key default gen_random_uuid(),
    instructor_id uuid not null references public.instructors(id) on delete cascade,
    kind          text not null check (kind in ('adi_badge', 'mot', 'insurance', 'road_tax', 'dual_controls', 'other')),
    -- Required for 'other' (a name for the custom deadline); optional otherwise.
    label         text check (label is null or char_length(label) <= 80),
    due_date      date not null,
    notes         text check (notes is null or char_length(notes) <= 500),
    created_at    timestamptz not null default now(),
    constraint instructor_deadlines_other_needs_label
        check (kind <> 'other' or coalesce(btrim(label), '') <> '')
);

-- One row per standard kind per instructor (you have one MOT date, not two).
-- Custom 'other' deadlines can repeat.
create unique index if not exists uq_instructor_deadlines_kind
    on public.instructor_deadlines (instructor_id, kind) where kind <> 'other';

create index if not exists idx_instructor_deadlines_due
    on public.instructor_deadlines (instructor_id, due_date);

alter table public.instructor_deadlines enable row level security;

drop policy if exists instructor_deadlines_own on public.instructor_deadlines;
create policy instructor_deadlines_own on public.instructor_deadlines
    for all
    using (instructor_id = public.current_user_instructor_id())
    with check (instructor_id = public.current_user_instructor_id());

-- ---------------------------------------------------------------------------
-- Which reminder stage has already gone out for which deadline date. Keyed by
-- (instructor, item_key, due_date, stage) rather than a foreign key so it works
-- for the derived standards-check item too (item_key = 'standards_check'). When
-- a deadline is renewed its due_date changes, so the new date starts fresh.
-- Written only by the backend job (service role); no policies on purpose, so
-- nobody using the app can read or write it.
-- ---------------------------------------------------------------------------
create table if not exists public.deadline_reminder_log (
    id            uuid primary key default gen_random_uuid(),
    instructor_id uuid not null references public.instructors(id) on delete cascade,
    item_key      text not null,
    due_date      date not null,
    stage         text not null check (stage in ('d30', 'd7', 'd1', 'overdue')),
    -- What actually went out: 'email', 'push', 'email+push', or 'none' (nobody
    -- reachable — recorded so we stop re-checking every morning).
    channels      text not null default '',
    sent_at       timestamptz not null default now(),
    unique (instructor_id, item_key, due_date, stage)
);

alter table public.deadline_reminder_log enable row level security;

-- ---------------------------------------------------------------------------
-- One list for the app and the job: stored deadlines + the derived standards
-- check. security_invoker so the caller's own RLS applies (an instructor only
-- ever sees their own rows); the backend job uses the service role, which
-- bypasses RLS as it does everywhere else.
-- ---------------------------------------------------------------------------
create or replace view public.instructor_deadline_items
    with (security_invoker = true) as
    select
        d.id::text            as item_key,
        d.id                  as id,
        d.instructor_id       as instructor_id,
        d.kind                as kind,
        d.label               as label,
        d.due_date            as due_date,
        d.notes               as notes,
        false                 as derived
    from public.instructor_deadlines d
    union all
    select
        'standards_check'                                   as item_key,
        null::uuid                                          as id,
        c.instructor_id                                     as instructor_id,
        'standards_check'                                   as kind,
        null::text                                          as label,
        (max(c.check_date) + interval '4 years')::date      as due_date,
        null::text                                          as notes,
        true                                                as derived
    from public.adi_standards_checks c
    group by c.instructor_id;

revoke all on public.instructor_deadline_items from anon;
grant select on public.instructor_deadline_items to authenticated;

-- =============================================================================
-- DONE.
-- =============================================================================
