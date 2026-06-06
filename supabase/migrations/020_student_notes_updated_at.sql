-- ============================================================================
-- Migration 020 — Track when instructor notes were last edited
-- ============================================================================
-- Adds `notes_updated_at` to `students` and a tiny trigger that auto-stamps
-- it whenever the `notes` column changes (including on initial insert). The
-- UI surfaces this as "Updated {when}" beneath the Instructor notes card.
--
-- Notes:
--   * The trigger only fires when `notes` actually changes — editing any
--     other column on the row leaves the timestamp untouched.
--   * Setting notes back to NULL still updates the timestamp so a "cleared"
--     state is auditable.
-- ============================================================================

alter table public.students
    add column if not exists notes_updated_at timestamptz;

create or replace function public.students_set_notes_updated_at()
returns trigger language plpgsql as $$
begin
    if tg_op = 'INSERT' then
        if new.notes is not null then
            new.notes_updated_at := now();
        end if;
        return new;
    end if;
    -- UPDATE: stamp only when notes is being changed.
    if new.notes is distinct from old.notes then
        new.notes_updated_at := now();
    end if;
    return new;
end;
$$;

drop trigger if exists trg_students_set_notes_updated_at on public.students;
create trigger trg_students_set_notes_updated_at
    before insert or update on public.students
    for each row execute function public.students_set_notes_updated_at();

comment on column public.students.notes_updated_at is
    'Timestamp set automatically by trigger whenever students.notes is changed.';
