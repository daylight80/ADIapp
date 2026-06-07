-- ============================================================================
-- Migration 021 — Track WHO last edited an instructor's notes
-- ============================================================================
-- Extends migration 020. Adds two columns to `students`:
--   • notes_updated_by      — uuid FK to the instructor row that last saved
--   • notes_updated_by_name — denormalised display name (saved at edit time
--     so the UI doesn't need a join on every render, and the audit trail is
--     preserved even if the instructor is later renamed or deleted).
--
-- The existing notes-trigger is extended to look up the calling instructor
-- via auth.uid() and populate both columns whenever `notes` changes. When
-- the service-role key is in use (no JWT context, e.g. SQL editor or a
-- backend cron), the lookup yields NULL and the columns are simply left
-- unset for that write — which is the desired behaviour.
-- ============================================================================

alter table public.students
    add column if not exists notes_updated_by      uuid
        references public.instructors(id) on delete set null,
    add column if not exists notes_updated_by_name text;

create or replace function public.students_set_notes_updated_at()
returns trigger language plpgsql as $$
declare
    caller_id   uuid;
    caller_name text;
begin
    -- INSERT path — only stamp when an initial note is provided
    if tg_op = 'INSERT' then
        if new.notes is not null then
            new.notes_updated_at := now();
            select id, full_name into caller_id, caller_name
              from public.instructors
             where auth_user_id = auth.uid()
             limit 1;
            new.notes_updated_by      := caller_id;
            new.notes_updated_by_name := caller_name;
        end if;
        return new;
    end if;

    -- UPDATE path — only when the notes value actually changes
    if new.notes is distinct from old.notes then
        new.notes_updated_at := now();
        select id, full_name into caller_id, caller_name
          from public.instructors
         where auth_user_id = auth.uid()
         limit 1;
        new.notes_updated_by      := caller_id;
        new.notes_updated_by_name := caller_name;
    end if;
    return new;
end;
$$;

comment on column public.students.notes_updated_by is
    'Instructor who last edited this student''s notes. Set automatically by trigger from auth.uid().';
comment on column public.students.notes_updated_by_name is
    'Denormalised display name of the instructor who last edited the notes. Snapshotted at edit time.';
