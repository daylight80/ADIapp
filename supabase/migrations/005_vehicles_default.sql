-- =============================================================================
-- Migration 005 — Vehicles: default flag + management RPC
-- =============================================================================
-- Adds an `is_default` boolean column on `public.vehicles` so the instructor
-- can pick which vehicle the Add-Lesson form pre-selects. Enforces that at
-- most one vehicle per school can be the default at any time (partial unique
-- index).
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.vehicles
    add column if not exists is_default boolean not null default false;

-- One default per school, at most.
create unique index if not exists ux_vehicles_default_per_school
    on public.vehicles(school_id)
    where is_default = true;

-- Quick lookup of the default vehicle for a given school.
create index if not exists idx_vehicles_school_default
    on public.vehicles(school_id, is_default);

-- =============================================================================
-- RPC: set_default_vehicle — atomically clears any existing default on the
-- school and marks the given vehicle as the new default. Runs as the calling
-- user so RLS still applies (owner only).
-- =============================================================================
create or replace function public.set_default_vehicle(p_vehicle_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_school uuid;
begin
    -- Look up the vehicle's school first (RLS will fail this if the caller
    -- isn't the owner — that's intended).
    select school_id into v_school from public.vehicles where id = p_vehicle_id;
    if v_school is null then
        raise exception 'Vehicle not found or access denied';
    end if;

    -- Clear any existing default within the same school, then set the new one.
    update public.vehicles set is_default = false where school_id = v_school and is_default = true;
    update public.vehicles set is_default = true  where id = p_vehicle_id;
end;
$$;

grant execute on function public.set_default_vehicle(uuid) to authenticated;

-- =============================================================================
-- Best-effort: if a school already has vehicles but none flagged as default,
-- promote the oldest one. Safe no-op when every school is empty.
-- =============================================================================
update public.vehicles v
   set is_default = true
  from (
    select distinct on (school_id) id
      from public.vehicles
     where school_id in (
       select school_id from public.vehicles
       group by school_id
       having bool_and(is_default = false)
     )
     order by school_id, created_at asc nulls last, id asc
  ) pick
 where v.id = pick.id;

-- =============================================================================
-- DONE.
-- =============================================================================
