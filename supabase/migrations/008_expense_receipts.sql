-- =============================================================================
-- Migration 008 — Digital Receipt Scanner: expense_receipts table
-- =============================================================================
-- Stores instructor-side business expense receipts (fuel, maintenance, car
-- wash, parking, tolls, MOT, insurance, lesson supplies, other) with OCR'd
-- metadata extracted server-side by Gemini 2.5 Flash. The receipt image
-- itself lives in Supabase Storage bucket `receipts` (private, signed URLs).
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. expense_receipts
-- ---------------------------------------------------------------------------
create table if not exists public.expense_receipts (
    id              uuid primary key default gen_random_uuid(),
    school_id       uuid not null references public.driving_schools(id) on delete cascade,
    instructor_id   uuid not null references public.instructors(id) on delete cascade,
    vehicle_id      uuid references public.vehicles(id) on delete set null,
    category        text not null,
    vendor          text,
    occurred_at     date not null default current_date,
    amount_total    numeric(10,2) not null default 0,
    vat_amount      numeric(10,2),
    currency        text not null default 'GBP',
    storage_path    text,        -- e.g. "<school_id>/<uuid>.jpg" in `receipts` bucket
    ocr_raw_text    text,
    notes           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint expense_receipts_category_chk
        check (category in ('fuel','maintenance','car_wash','parking','tolls','mot','insurance','lesson_supplies','other'))
);

create index if not exists idx_expense_receipts_school     on public.expense_receipts(school_id, occurred_at desc);
create index if not exists idx_expense_receipts_instructor on public.expense_receipts(instructor_id, occurred_at desc);
create index if not exists idx_expense_receipts_category   on public.expense_receipts(school_id, category, occurred_at desc);

alter table public.expense_receipts enable row level security;

-- Instructors (school owners) can manage all receipts in their school.
drop policy if exists expense_receipts_owner_all on public.expense_receipts;
create policy expense_receipts_owner_all on public.expense_receipts
    for all
    using (
        exists (
            select 1 from public.driving_schools s
            where s.id = expense_receipts.school_id and s.owner_auth_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.driving_schools s
            where s.id = expense_receipts.school_id and s.owner_auth_id = auth.uid()
        )
    );

-- updated_at trigger
create or replace function public.set_expense_receipts_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_expense_receipts_updated_at on public.expense_receipts;
create trigger trg_expense_receipts_updated_at
    before update on public.expense_receipts
    for each row execute function public.set_expense_receipts_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Storage bucket: receipts (private)
-- ---------------------------------------------------------------------------
-- This must be created via the Storage UI OR via the storage API. Run the
-- following snippet ONCE in the SQL editor — it's idempotent.
insert into storage.buckets (id, name, public)
    values ('receipts', 'receipts', false)
    on conflict (id) do nothing;

-- Storage RLS — allow signed-in instructor (school owner) to upload/read/delete
-- files prefixed with their own school_id.
drop policy if exists receipts_owner_read   on storage.objects;
create policy receipts_owner_read on storage.objects
    for select using (
        bucket_id = 'receipts'
        and exists (
            select 1 from public.driving_schools s
            where s.owner_auth_id = auth.uid()
              and (storage.foldername(name))[1] = s.id::text
        )
    );

drop policy if exists receipts_owner_insert on storage.objects;
create policy receipts_owner_insert on storage.objects
    for insert with check (
        bucket_id = 'receipts'
        and exists (
            select 1 from public.driving_schools s
            where s.owner_auth_id = auth.uid()
              and (storage.foldername(name))[1] = s.id::text
        )
    );

drop policy if exists receipts_owner_delete on storage.objects;
create policy receipts_owner_delete on storage.objects
    for delete using (
        bucket_id = 'receipts'
        and exists (
            select 1 from public.driving_schools s
            where s.owner_auth_id = auth.uid()
              and (storage.foldername(name))[1] = s.id::text
        )
    );

-- =============================================================================
-- DONE.
-- =============================================================================
