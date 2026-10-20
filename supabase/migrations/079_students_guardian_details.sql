-- Parent or guardian contact for a pupil under 18 (all optional). Set by the instructor on the pupil's profile.
alter table public.students
  add column if not exists guardian_name  text check (guardian_name  is null or char_length(guardian_name)  <= 100),
  add column if not exists guardian_phone text check (guardian_phone is null or char_length(guardian_phone) <= 20),
  add column if not exists guardian_email text check (guardian_email is null or char_length(guardian_email) <= 254);
comment on column public.students.guardian_name  is 'Parent or guardian of a pupil under 18 (optional). Set by the instructor.';
