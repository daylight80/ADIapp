// Travel time: the minutes it takes to get TO a lesson from the one before it (22 Oct 2026: it used to be drawn
// after the lesson it was stored on, which put the time in the wrong place, and after the last lesson of the day
// where there is nowhere to go). The lesson itself (its start and end time, length and price) never changes; the
// diary draws the travel as a strip in the gap just before the lesson, only when there is an earlier lesson that
// day, and booking a lesson closer to the one before than the travel time gets a "tight turnaround" warning.
// Pure logic, unit-tested.

export const MAX_BUFFER_MINUTES = 120;
export const DEFAULT_BUFFER_MINUTES = 15;
export const BUFFER_CHOICES = [0, 5, 10, 15, 20, 30];

/** Whole minutes between 0 and MAX_BUFFER_MINUTES; anything unusable counts as 0. */
export function cleanBufferMinutes(value: unknown): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_BUFFER_MINUTES, Math.round(n));
}

/** The travel time to reach this lesson from the previous one: none for a cancelled lesson. */
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
 * Lessons the candidate would squeeze: the candidate starting sooner after an earlier lesson than its own travel
 * time, or a later lesson starting sooner after the candidate than that lesson's travel time. Lessons that overlap
 * the candidate itself are real clashes, handled elsewhere, so they're skipped here.
 */
export function findTightTurnarounds(candidate: TimedLesson, others: TimedLesson[]): TightTurnaround[] {
  const found: TightTurnaround[] = [];
  for (const o of others) {
    if (o.id === candidate.id) continue;
    if (o.endMin <= candidate.startMin) {
      const gap = candidate.startMin - o.endMin;
      if (gap < candidate.buffer) found.push({ otherId: o.id, otherIsBefore: true, gapMinutes: gap, neededMinutes: candidate.buffer });
    } else if (o.startMin >= candidate.endMin) {
      const gap = o.startMin - candidate.endMin;
      if (gap < o.buffer) found.push({ otherId: o.id, otherIsBefore: false, gapMinutes: gap, neededMinutes: o.buffer });
    }
  }
  return found;
}

/**
 * The travel strip to draw before a lesson: it fills the gap just before the lesson's start, never more than the
 * time between the two lessons, and only when there is an earlier lesson (prevEndMin is null for the first of the
 * day, which gets no strip). Returns where it starts and how long it is, in minutes, or null for none.
 */
export function travelStripBefore(prevEndMin: number | null, startMin: number, travel: number): { fromMin: number; minutes: number } | null {
  if (prevEndMin === null || travel <= 0) return null;
  const minutes = Math.min(travel, startMin - prevEndMin);
  return minutes > 0 ? { fromMin: startMin - minutes, minutes } : null;
}

/** The bookable gap between two lessons once the travel to the later one is set aside, if it is at least minFree long. */
export function freeSlotBefore(prevEndMin: number, startMin: number, travel: number, minFree = 60): { fromMin: number; toMin: number } | null {
  const toMin = startMin - Math.max(0, travel);
  return toMin - prevEndMin >= minFree ? { fromMin: prevEndMin, toMin } : null;
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
