// Travel buffer: the minutes after a lesson to get to the next one. The lesson itself (its end time,
// length and price) never changes; the diary draws the buffer as a strip under the lesson, and booking
// something that starts inside it gets a "tight turnaround" warning. Pure logic, unit-tested.

export const MAX_BUFFER_MINUTES = 120;
export const DEFAULT_BUFFER_MINUTES = 15;
export const BUFFER_CHOICES = [0, 5, 10, 15, 20, 30];

/** Whole minutes between 0 and MAX_BUFFER_MINUTES; anything unusable counts as 0. */
export function cleanBufferMinutes(value: unknown): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_BUFFER_MINUTES, Math.round(n));
}

/** The buffer to draw after a lesson: none for a cancelled lesson. */
export function lessonBuffer(l: { travel_minutes?: number | null; status?: string | null }): number {
  return l.status === 'Cancelled' ? 0 : cleanBufferMinutes(l.travel_minutes);
}

export type TimedLesson = { id: string; startMin: number; endMin: number; buffer: number };

export type TightTurnaround = {
  otherId: string;
  /** true when the other lesson is the earlier one */
  otherIsBefore: boolean;
  gapMinutes: number;
  neededMinutes: number;
};

/**
 * Lessons the candidate would squeeze: an earlier lesson whose buffer reaches past the candidate's start,
 * or the candidate's own buffer reaching past a later lesson's start. Lessons that overlap the candidate
 * itself are real clashes, handled elsewhere, so they're skipped here.
 */
export function findTightTurnarounds(candidate: TimedLesson, others: TimedLesson[]): TightTurnaround[] {
  const found: TightTurnaround[] = [];
  for (const o of others) {
    if (o.id === candidate.id) continue;
    if (o.endMin <= candidate.startMin) {
      const gap = candidate.startMin - o.endMin;
      if (gap < o.buffer) found.push({ otherId: o.id, otherIsBefore: true, gapMinutes: gap, neededMinutes: o.buffer });
    } else if (o.startMin >= candidate.endMin) {
      const gap = o.startMin - candidate.endMin;
      if (gap < candidate.buffer) found.push({ otherId: o.id, otherIsBefore: false, gapMinutes: gap, neededMinutes: candidate.buffer });
    }
  }
  return found;
}

const mins = (n: number) => `${n} min${n === 1 ? '' : 's'}`;

/** "Jane's lesson ends just 5 mins before this one, but you need 15 mins to travel." */
export function describeTightTurnaround(t: TightTurnaround, otherName: string): string {
  const who = otherName || 'another';
  const gap = t.gapMinutes === 0 ? 'right before' : `${mins(t.gapMinutes)} before`;
  const allow = `but you allow ${mins(t.neededMinutes)} to travel.`;
  return t.otherIsBefore
    ? `${who}'s lesson ends ${gap} this one, ${allow}`
    : `This lesson ends ${gap} ${who}'s, ${allow}`;
}
