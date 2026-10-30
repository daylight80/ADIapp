-- ============================================================================
-- Migration 096 — A secret key per school for the website enquiry form
-- ============================================================================
-- A DC Pro instructor (their own school) or a Franchise school puts a form on their
-- website. The form posts to /api/public/enquiries/<key>; the key says which school
-- the enquiry is for. It is a long random value (a uuid with the dashes removed, 122
-- random bits), so it cannot be guessed. Starter schools have a key too, but the
-- endpoint ignores it: only DC Pro and Franchise take website enquiries.
--
--   enquiry_form_key      the secret in the form's address. Unique.
--   enquiry_form_enabled  the owner can switch the form off without changing the key.
--
-- Additive and idempotent. Safe to apply before the code that uses it.
-- ============================================================================

alter table public.driving_schools
    add column if not exists enquiry_form_key text,
    add column if not exists enquiry_form_enabled boolean not null default true;

update public.driving_schools
   set enquiry_form_key = replace(gen_random_uuid()::text, '-', '')
 where enquiry_form_key is null;

alter table public.driving_schools
    alter column enquiry_form_key set default replace(gen_random_uuid()::text, '-', ''),
    alter column enquiry_form_key set not null;

create unique index if not exists ux_driving_schools_enquiry_form_key
    on public.driving_schools (enquiry_form_key);
