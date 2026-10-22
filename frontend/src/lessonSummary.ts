// Dictated lesson summaries, app side. The instructor dictates with their phone keyboard's microphone key (so only
// text is ever sent), the backend drafts a summary and a plan for the next lesson, the instructor edits and
// approves it, and only then does the pupil see it. The Anthropic call is made by the backend, never the app.
import { supabase } from './supabaseClient';
import { callBackend } from './backendCall';

// Mirrors backend/lesson_summaries.py.
export const MIN_DICTATION_CHARS = 15;
export const MAX_DICTATION_CHARS = 4000;
export const MAX_SUMMARY_CHARS = 1500;
export const MAX_PLAN_CHARS = 1000;

export const DICTATION_HINT =
  'Tap the microphone on your keyboard and speak for 20 to 30 seconds: what went well, what to work on, anything to do next time.';

/** The same, in the web app, where there is a Dictate button as well as the keyboard. */
export const WEB_DICTATION_HINT =
  'Click Dictate and speak for 20 to 30 seconds: what went well, what to work on, anything to do next time. You can also type, and you can edit what appears.';

/** Shown to the pupil under every summary, so it is clear how it was written. */
export const SUMMARY_NOTE_PUPIL = 'Written by your instructor with the help of an AI assistant, and checked by them before you saw it.';

export type SummaryDraft = { summary: string; next_plan: string };
export type SavedSummary = { summary: string; next_plan: string | null; approved_at: string; notified_at: string | null };
export type ApproveResult = { ok: boolean; notified: 'push' | 'email' | null; updated: boolean };

/** Ready to send for drafting: enough to work from, and not over the limit. */
export function dictationReady(text: string): boolean {
  const n = (text || '').trim().length;
  return n >= MIN_DICTATION_CHARS && n <= MAX_DICTATION_CHARS;
}

/** Ready to approve: a summary, within the limits. The plan for next time may be empty. */
export function approvalReady(summary: string, plan: string): boolean {
  const s = (summary || '').trim().length;
  return s > 0 && s <= MAX_SUMMARY_CHARS && (plan || '').trim().length <= MAX_PLAN_CHARS;
}

/** What to tell the instructor once it has been sent. */
export function sentMessage(firstName: string, r: Pick<ApproveResult, 'notified' | 'updated'>): string {
  if (r.updated) return `Updated. ${firstName} will see the new wording the next time they open it.`;
  if (r.notified === 'push') return `Sent. ${firstName} has been notified in the app.`;
  if (r.notified === 'email') return `Sent. ${firstName} doesn't have the app on a phone, so it went by email.`;
  return `Saved. We couldn't notify ${firstName}, but they'll see it the next time they open the app.`;
}

const call = callBackend;

export const draftSummary = (lessonId: string, dictation: string) =>
  call<SummaryDraft>(`/v2/lessons/${lessonId}/summary/draft`, 'POST', { dictation });

export const approveSummary = (lessonId: string, summary: string, nextPlan: string) =>
  call<ApproveResult>(`/v2/lessons/${lessonId}/summary`, 'POST', { summary, next_plan: nextPlan.trim() || null });

export const withdrawSummary = (lessonId: string) => call<{ ok: boolean }>(`/v2/lessons/${lessonId}/summary`, 'DELETE');

/** A summary already sent for this lesson (the instructor can read their own), so it can be edited. */
export async function fetchSavedSummary(lessonId: string): Promise<SavedSummary | null> {
  const { data, error } = await supabase
    .from('lesson_summaries')
    .select('summary,next_plan,approved_at,notified_at')
    .eq('lesson_id', lessonId)
    .maybeSingle();
  if (error) throw error;
  return (data as SavedSummary | null) ?? null;
}

export type PupilSummary = {
  id: string;
  lesson_id: string;
  summary: string;
  next_plan: string | null;
  approved_at: string;
  lesson_date: string;
  topic: string | null;
  instructor_first_name: string;
};

/** The pupil's own approved summaries, newest first (migration 084: the database only returns approved text). */
export async function fetchMySummaries(): Promise<PupilSummary[]> {
  const { data, error } = await supabase.rpc('my_lesson_summaries');
  if (error) throw error;
  return Array.isArray(data) ? (data as PupilSummary[]) : [];
}
