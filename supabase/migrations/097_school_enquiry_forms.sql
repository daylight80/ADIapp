-- ============================================================================
-- Migration 097 — The website enquiry form key moves to a table only the school owner can read
-- ============================================================================
-- Migration 096 put the form key on driving_schools, and the policy ds_instructor_read lets every instructor in a
-- school read that row, so a Franchise sub-instructor could read the key. The key lets anyone post enquiries into
-- the school, so it belongs to the owner alone.
--
--   school_enquiry_forms   one row per school: the secret key and the on/off switch.
--                          Read: the school owner. Written: only by the server (service role), so there is no
--                          write policy for signed-in users.
--
-- The server creates a school's row the first time its owner opens the form settings, so a school that has never
-- set the form up has no key at all. The two columns on driving_schools are left in place by this migration (the
-- code deployed before this change still reads them) and are dropped by the next one.
--
-- Additive and idempotent. Safe to apply before the code that uses it.
-- ============================================================================

create table if not exists public.school_enquiry_forms (
    school_id   uuid primary key references public.driving_schools(id) on delete cascade,
    form_key    text not null unique check (form_key ~ '^[0-9a-f]{32}$'),
    enabled     boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

alter table public.school_enquiry_forms enable row level security;

drop policy if exists school_enquiry_forms_owner_read on public.school_enquiry_forms;
create policy school_enquiry_forms_owner_read on public.school_enquiry_forms
    for select
    using (public.is_school_owner(school_id));

-- Keep what 096 already made, so a key a school may already have copied stays the same.
insert into public.school_enquiry_forms (school_id, form_key, enabled)
select id, enquiry_form_key, enquiry_form_enabled
  from public.driving_schools
 where enquiry_form_key ~ '^[0-9a-f]{32}$'
on conflict (school_id) do nothing;
