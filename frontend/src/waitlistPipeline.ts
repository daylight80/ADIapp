// The waiting-list pipeline: pupils on the Waitlist status move Waiting -> Contacted -> Booked, and "Started" is
// simply becoming Active. Pure logic, tested in __tests__/waitlistPipeline.test.ts. Migration 086 keeps the stage in step.

export type WaitlistStage = 'Waiting' | 'Contacted' | 'Booked';
export const WAITLIST_STAGES: WaitlistStage[] = ['Waiting', 'Contacted', 'Booked'];

/** A pupil left in Waiting this long without being contacted is flagged in the Action Centre. */
export const WAITING_NUDGE_DAYS = 7;

type PupilLike = { status?: string | null; waitlist_stage?: string | null; waitlist_stage_at?: string | null };

export function isWaitlisted(s: PupilLike): boolean {
  return s.status === 'Waitlist';
}

/** The pupil's stage, or null when they are not on the waiting list. A waitlisted pupil with no stage yet counts as Waiting. */
export function stageOf(s: PupilLike): WaitlistStage | null {
  if (!isWaitlisted(s)) return null;
  return WAITLIST_STAGES.includes(s.waitlist_stage as WaitlistStage) ? (s.waitlist_stage as WaitlistStage) : 'Waiting';
}

/** Whole days since the pupil reached their stage, or null when unknown. */
export function daysInStage(s: PupilLike, now: Date): number | null {
  if (!s.waitlist_stage_at) return null;
  const t = new Date(s.waitlist_stage_at).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** How many waitlisted pupils are at each stage. */
export function stageCounts(students: PupilLike[]): Record<WaitlistStage, number> {
  const out: Record<WaitlistStage, number> = { Waiting: 0, Contacted: 0, Booked: 0 };
  for (const s of students) {
    const st = stageOf(s);
    if (st) out[st] += 1;
  }
  return out;
}

/** The stage to offer next (Waiting -> Contacted -> Booked), or null at the end. */
export function nextStage(from: WaitlistStage | null): WaitlistStage | null {
  if (!from) return null;
  const i = WAITLIST_STAGES.indexOf(from);
  return WAITLIST_STAGES[i + 1] ?? null;
}

/** "Waiting 9 days", "Contacted today" */
export function stageSummary(s: PupilLike, now: Date): string {
  const st = stageOf(s);
  if (!st) return '';
  const d = daysInStage(s, now);
  if (d === null) return st;
  return `${st} ${d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`}`;
}
