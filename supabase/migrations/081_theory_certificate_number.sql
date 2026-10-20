-- The theory test pass certificate number (optional), kept on the pupil's theory test outcome. The instructor can
-- find it with the DVSA lookup (https://www.gov.uk/find-theory-test-pass-number) and it is needed to book the
-- practical test.
alter table public.test_outcomes
  add column if not exists theory_certificate_number text check (theory_certificate_number is null or char_length(theory_certificate_number) <= 20);
comment on column public.test_outcomes.theory_certificate_number is 'Theory test pass certificate number (optional), from the DVSA lookup. Needed to book the practical test.';
