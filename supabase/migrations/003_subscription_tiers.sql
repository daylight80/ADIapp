-- =============================================================================
-- ADI Pro — 003 Subscription tiers + per-seat billing
-- =============================================================================
-- Adds the four-tier pricing model:
--   • starter   — Free                — max  5 active students, 1 instructor
--   • growth    — £14.99 / month       — max 15 active students, 1 instructor
--   • pro       — £24.99 / month       — unlimited students,      1 instructor
--   • franchise — £39.99 / month base  — unlimited students,      unlimited
--                + £10.00 per extra        instructors (seat-based)
--
-- Run AFTER 002_extended_columns.sql. Idempotent.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add tier + Stripe linkage to driving_schools
-- ----------------------------------------------------------------------------
alter table public.driving_schools
    add column if not exists tier                   text not null default 'starter',
    add column if not exists stripe_customer_id     text,
    add column if not exists stripe_subscription_id text,
    add column if not exists seat_count             int  not null default 1,
    add column if not exists current_period_end     timestamptz;

do $$ begin
    alter table public.driving_schools
        add constraint driving_schools_tier_chk
        check (tier in ('starter','growth','pro','franchise'));
exception when duplicate_object then null; end $$;

do $$ begin
    alter table public.driving_schools
        add constraint driving_schools_seat_chk
        check (seat_count >= 1);
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Tier metadata helpers
-- ----------------------------------------------------------------------------

-- Maximum active students permitted by a tier (NULL = unlimited)
create or replace function public.tier_student_limit(t text)
returns int
language sql
immutable
as $$
    select case t
        when 'starter'   then 5
        when 'growth'    then 15
        when 'pro'       then null
        when 'franchise' then null
        else 5
    end
$$;

-- Maximum instructors permitted by a tier (NULL = unlimited)
create or replace function public.tier_instructor_limit(t text)
returns int
language sql
immutable
as $$
    select case t
        when 'starter'   then 1
        when 'growth'    then 1
        when 'pro'       then 1
        when 'franchise' then null
        else 1
    end
$$;

-- Active student count for a school — anyone not yet Passed counts.
create or replace function public.count_active_students(school uuid)
returns int
language sql
security definer
set search_path = public
as $$
    select count(*)::int
    from public.students
    where school_id = school
      and status <> 'Passed'
$$;

-- Can this school add another active student under its current tier?
create or replace function public.can_add_student(school uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
    select
        case
            when public.tier_student_limit(
                (select tier from public.driving_schools where id = school)
            ) is null then true   -- unlimited
            else public.count_active_students(school)
               < public.tier_student_limit(
                    (select tier from public.driving_schools where id = school)
                 )
        end
$$;

-- Can this school add another instructor under its current tier?
create or replace function public.can_add_instructor(school uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
    select
        case
            when public.tier_instructor_limit(
                (select tier from public.driving_schools where id = school)
            ) is null then true
            else (
                select count(*)::int from public.instructors where school_id = school
            ) < public.tier_instructor_limit(
                (select tier from public.driving_schools where id = school)
            )
        end
$$;

grant execute on function public.tier_student_limit(text)         to authenticated;
grant execute on function public.tier_instructor_limit(text)      to authenticated;
grant execute on function public.count_active_students(uuid)      to authenticated;
grant execute on function public.can_add_student(uuid)            to authenticated;
grant execute on function public.can_add_instructor(uuid)         to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Enforce limits on INSERT via triggers (server-side guarantee)
-- ----------------------------------------------------------------------------

create or replace function public.enforce_student_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status = 'Passed' then
        return new;   -- inserting an already-passed historical record is fine
    end if;
    if not public.can_add_student(new.school_id) then
        raise exception 'STUDENT_LIMIT_REACHED'
            using errcode = 'P0001',
                  hint = 'Upgrade your subscription to add more students.';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_students_limit on public.students;
create trigger trg_students_limit
before insert on public.students
for each row execute function public.enforce_student_limit();


create or replace function public.enforce_instructor_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.can_add_instructor(new.school_id) then
        raise exception 'INSTRUCTOR_LIMIT_REACHED'
            using errcode = 'P0001',
                  hint = 'Upgrade to the Franchise tier to add additional instructors.';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_instructors_limit on public.instructors;
create trigger trg_instructors_limit
before insert on public.instructors
for each row execute function public.enforce_instructor_limit();

-- ----------------------------------------------------------------------------
-- 4. Auto-maintain seat_count on driving_schools when instructors are added /
--    removed. Backend webhook should read this value to keep Stripe in sync.
-- ----------------------------------------------------------------------------

create or replace function public.recount_seat_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare sid uuid;
begin
    if tg_op = 'DELETE' then sid := old.school_id; else sid := new.school_id; end if;
    update public.driving_schools
       set seat_count = greatest(1, (
           select count(*)::int from public.instructors where school_id = sid
       ))
     where id = sid;
    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_instructors_seat_count on public.instructors;
create trigger trg_instructors_seat_count
after insert or delete on public.instructors
for each row execute function public.recount_seat_count();

-- ----------------------------------------------------------------------------
-- 5. Convenience view: schools_with_usage
--    Joins the school with its current usage counts so the app can fetch
--    everything it needs to render the pricing UI in one call.
-- ----------------------------------------------------------------------------

create or replace view public.schools_with_usage
with (security_invoker = true)
as
select
    s.id,
    s.business_name,
    s.owner_auth_id,
    s.tier,
    s.subscription_status,
    s.stripe_customer_id,
    s.stripe_subscription_id,
    s.seat_count,
    s.current_period_end,
    public.tier_student_limit(s.tier)    as student_limit,
    public.tier_instructor_limit(s.tier) as instructor_limit,
    (select count(*) from public.students    where school_id = s.id and status <> 'Passed') as active_students,
    (select count(*) from public.instructors where school_id = s.id) as instructor_count
from public.driving_schools s;

grant select on public.schools_with_usage to authenticated;

-- =============================================================================
-- End of migration 003
-- =============================================================================
