-- A Practical Test booking is one block in the diary: the lesson start (start_time) to the lesson end (end_time),
-- with the test itself starting at test_start inside it. test_centre (migration 078) says where.
alter table public.lessons add column if not exists test_start timestamptz;
comment on column public.lessons.test_start is 'Practical Test bookings: when the test itself starts, inside the lesson block (start_time to end_time).';
