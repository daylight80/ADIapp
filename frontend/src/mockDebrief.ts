// The AI debrief for a mock test (DL25): the instructor writes it after scoring the test, and the pupil
// sees it on their home screen. The backend holds the model call and saves the result on the attempt.
import { api } from './api';

export type MockDebriefResult = { debrief: string | null; generated_at: string | null };

export async function generateMockDebrief(attemptId: string): Promise<MockDebriefResult> {
  const res = await api.post(`/v2/mock-tests/${attemptId}/debrief`, undefined, { timeout: 45000 });
  return res.data as MockDebriefResult;
}

export async function removeMockDebrief(attemptId: string): Promise<void> {
  await api.delete(`/v2/mock-tests/${attemptId}/debrief`);
}

/** The backend words its own refusals; anything else gets a plain message. */
export function mockDebriefErrorMessage(e: unknown): string {
  const detail = (e as any)?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim() && !/anthropic|api_key/i.test(detail)) return detail;
  return "Couldn't write the debrief just now. Please try again in a moment.";
}

export const MOCK_DEBRIEF_NOTE_INSTRUCTOR =
  'Written by AI from the marks you entered. The pupil sees it on their home screen, so read it through first and remove it if it is not right.';

export const MOCK_DEBRIEF_NOTE_PUPIL = "Written by AI from your instructor's marks.";
