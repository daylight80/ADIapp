-- When each fault was marked during a mock test (DL25), so it can be placed on the recording's route afterwards.
-- A JSON list of { key, type, t }: the DL25 line, driving/serious/dangerous, and the time in ms. Only set for a test
-- the instructor ran live; null for older tests and for a test with no faults. The list is capped at 200 entries.
alter table public.mock_test_attempts add column if not exists fault_events jsonb
  check (fault_events is null or (jsonb_typeof(fault_events) = 'array' and jsonb_array_length(fault_events) <= 200));
