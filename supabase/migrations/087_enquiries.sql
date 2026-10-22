-- ============================================================================
-- Migration 087 — Enquiries board: people who are not a pupil record yet
-- ============================================================================
-- An enquiry is someone who has asked about lessons (website form, phone call,
-- Facebook message, word of mouth) and has no pupil record yet. It moves
-- Waiting -> Contacted -> Booked, and when they start it is converted into a
-- real pupil (converted_student_id). Each time the instructor rings, texts or
-- emails them, a row goes in enquiry_contacts, so "who did I last speak to, and
-- when" is never a guess.
--
--   enquiries          one row per enquiry, private to the instructor it belongs
--                      to (the school owner can read, like pupils).
--   enquiry_contacts   the contact log: a call, text, email or plain note, dated.
--
-- Kept in step by triggers:
--   - the stage changing                 -> stage_at = now()
--   - a call/text/email being logged     -> last_contacted_at = that time, and a
--                                           Waiting enquiry becomes Contacted
-- Additive and idempotent. Safe to apply before the code that uses it.
-- ============================================================================

create table if not exists public.enquiries (
    id                    uuid primary key default gen_random_uuid(),
    instructor_id         uuid not null references public.instructors(id) on delete cascade,
    school_id             uuid references public.driving_schools(id) on delete cascade,
    name                  text not null check (char_length(btrim(name)) between 1 and 100),
    phone                 text check (phone is null or char_length(phone) <= 30),
    email                 text check (email is null or char_length(email) <= 200),
    postcode              text check (postcode is null or char_length(postcode) <= 10),
    source                text check (source is null or char_length(source) <= 40),
    notes                 text check (notes is null or char_length(notes) <= 1000),
    stage                 text not null default 'Waiting' check (stage in ('Waiting', 'Contacted', 'Booked')),
    stage_at              timestamptz not null default now(),
    last_contacted_at     timestamptz,
    converted_student_id  uuid references public.students(id) on delete set null,
    converted_at          timestamptz,
    closed_at             timestamptz,
    closed_reason         text check (closed_reason is null or char_length(closed_reason) <= 200),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

create index if not exists idx_enquiries_instructor_open
    on public.enquiries (instructor_id, stage, created_at)
    where converted_at is null and closed_at is null;

create table if not exists public.enquiry_contacts (
    id            uuid primary key default gen_random_uuid(),
    enquiry_id    uuid not null references public.enquiries(id) on delete cascade,
    instructor_id uuid not null references public.instructors(id) on delete cascade,
    kind          text not null check (kind in ('call', 'text', 'email', 'note')),
    note          text check (note is null or char_length(note) <= 500),
    contacted_at  timestamptz not null default now()
);

create index if not exists idx_enquiry_contacts_enquiry on public.enquiry_contacts (enquiry_id, contacted_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.enquiries_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at := now();
    if tg_op = 'INSERT' then
        new.stage_at := coalesce(new.stage_at, now());
    elsif new.stage is distinct from old.stage then
        new.stage_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists trg_enquiries_before_write on public.enquiries;
create trigger trg_enquiries_before_write
    before insert or update on public.enquiries
    for each row execute function public.enquiries_before_write();

create or replace function public.enquiry_contacts_after_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.kind <> 'note' then
        update public.enquiries
        set last_contacted_at = greatest(coalesce(last_contacted_at, new.contacted_at), new.contacted_at),
            stage = case when stage = 'Waiting' then 'Contacted' else stage end
        where id = new.enquiry_id;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_enquiry_contacts_after_insert on public.enquiry_contacts;
create trigger trg_enquiry_contacts_after_insert
    after insert on public.enquiry_contacts
    for each row execute function public.enquiry_contacts_after_insert();

-- ---------------------------------------------------------------------------
-- Row-level security: the instructor's own rows; the school owner can read.
-- ---------------------------------------------------------------------------
alter table public.enquiries enable row level security;
alter table public.enquiry_contacts enable row level security;

drop policy if exists enquiries_own on public.enquiries;
create policy enquiries_own on public.enquiries
    for all
    using (instructor_id = public.current_user_instructor_id())
    with check (instructor_id = public.current_user_instructor_id());

drop policy if exists enquiries_owner_read on public.enquiries;
create policy enquiries_owner_read on public.enquiries
    for select
    using (school_id is not null and public.is_school_owner(school_id));

-- A contact can only be logged against one of the instructor's own enquiries.
drop policy if exists enquiry_contacts_own on public.enquiry_contacts;
create policy enquiry_contacts_own on public.enquiry_contacts
    for all
    using (instructor_id = public.current_user_instructor_id())
    with check (
        instructor_id = public.current_user_instructor_id()
        and exists (
            select 1 from public.enquiries e
            where e.id = enquiry_id and e.instructor_id = public.current_user_instructor_id()
        )
    );
