-- =============================================================================
-- Migration 027 — School profile fields (branding + contact details)
-- =============================================================================
-- driving_schools had a business_name (auto-generated at signup, never
-- editable) but nothing else — no logo, no contact details. This adds what
-- a real "school profile" screen needs, and what the existing PDF invoice
-- generator can use instead of the hardcoded "ADI Pro" branding it has now.
-- =============================================================================

alter table public.driving_schools
    add column if not exists logo_url text;

alter table public.driving_schools
    add column if not exists contact_email text;

alter table public.driving_schools
    add column if not exists contact_phone text;

alter table public.driving_schools
    add column if not exists address text;

-- Storage bucket for logo uploads. Public read (logos aren't sensitive and
-- need to render directly in generated invoice HTML/PDF without a
-- signed-URL round trip each time), but only the school owner can
-- upload/replace/delete their own school's logo.
insert into storage.buckets (id, name, public)
values ('school-logos', 'school-logos', true)
on conflict (id) do nothing;

drop policy if exists school_logos_public_read on storage.objects;
create policy school_logos_public_read on storage.objects
    for select
    using (bucket_id = 'school-logos');

-- Uploaded paths are expected to be "<school_id>/logo.<ext>" — only that
-- school's owner may write to their own folder.
drop policy if exists school_logos_owner_write on storage.objects;
create policy school_logos_owner_write on storage.objects
    for insert
    with check (
        bucket_id = 'school-logos'
        and exists (
            select 1 from public.driving_schools ds
            where ds.id::text = (storage.foldername(name))[1]
              and ds.owner_auth_id = auth.uid()
        )
    );

drop policy if exists school_logos_owner_update on storage.objects;
create policy school_logos_owner_update on storage.objects
    for update
    using (
        bucket_id = 'school-logos'
        and exists (
            select 1 from public.driving_schools ds
            where ds.id::text = (storage.foldername(name))[1]
              and ds.owner_auth_id = auth.uid()
        )
    );

drop policy if exists school_logos_owner_delete on storage.objects;
create policy school_logos_owner_delete on storage.objects
    for delete
    using (
        bucket_id = 'school-logos'
        and exists (
            select 1 from public.driving_schools ds
            where ds.id::text = (storage.foldername(name))[1]
              and ds.owner_auth_id = auth.uid()
        )
    );

-- =============================================================================
-- DONE.
-- =============================================================================
