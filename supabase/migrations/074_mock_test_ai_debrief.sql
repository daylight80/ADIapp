-- An AI-written debrief for a mock test (DL25) attempt. The instructor taps "Write a debrief" after scoring the
-- test; the backend writes it here, and the pupil sees it on their home screen (pupils can already read their own
-- attempts). Cleared again if the instructor removes it. Written by the backend only.
alter table public.mock_test_attempts add column if not exists ai_debrief text check (ai_debrief is null or char_length(ai_debrief) <= 2000);
alter table public.mock_test_attempts add column if not exists ai_debrief_generated_at timestamptz;
