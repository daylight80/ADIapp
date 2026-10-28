-- Links a mock test (DL25) attempt to the Route Recorder recording it was run during. Recordings live on the
-- instructor's phone, so this is just the recording's id (text, not a foreign key). Null for a mock test run on its own.
alter table public.mock_test_attempts add column if not exists route_id text check (route_id is null or char_length(route_id) <= 64);
create index if not exists mock_test_attempts_route_id_idx on public.mock_test_attempts (route_id) where route_id is not null;
