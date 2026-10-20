-- Where a Practical Test entry in the diary takes place (the driving test centre). Navigation, travel time
-- and the pupil's next-lesson card use it for Practical Test lessons, instead of the pickup address.
alter table public.lessons add column if not exists test_centre text check (test_centre is null or char_length(test_centre) <= 200);
comment on column public.lessons.test_centre is 'Where a Practical Test lesson takes place (the driving test centre). Used for navigation and shown to the pupil.';
