// Moving a lesson to another date or time: what to check first. Pure logic, unit-tested.
//
// A teacher can move a lesson anywhere, with two things that stop it (a clash with another lesson, and time they have
// marked as unavailable) and a few that only warn (the time is in the past, or too little travel time between
// lessons). The warnings are the same ones the diary's drag and Add Lesson give, from ./buffer.

import { findTightTurnarounds, describeTightTurnaround, lessonBuffer, type TimedLesson } from './buffer';

/** Another lesson of the same instructor on the day being moved to, with its times as minutes after midnight. */
export type DayLesson = {
  id: string;
  startMin: number;
  endMin: number;
  status?: string | null;
  travel_minutes?: number | null;
  studentName?: string;
};

export type TimeBlock = { starts_at: string; ends_at: string };

export type MoveInput = {
  lessonId: string;
  /** Where the lesson is now. */
  from: { date: string; startTime: string };
  /** Where it is going: YYYY-MM-DD and HH:mm. */
  date: string;
  startTime: string;
  durationMinutes: number;
  /** Travel time to reach this lesson from the one before it. */
  travelMinutes?: number | null;
  dayLessons: DayLesson[];
  blocks: TimeBlock[];
  now?: Date;
};

export type MoveCheck = {
  endTime: string;
  changed: boolean;
  /** These stop the move. */
  blockers: string[];
  /** These are shown, and the teacher may carry on. */
  warnings: string[];
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const fromMinutes = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** The lesson's length stays the same when it moves, so the end time follows the start. "" if it would pass midnight. */
export function endTimeFor(startTime: string, durationMinutes: number): string {
  if (!TIME.test(startTime)) return '';
  const end = toMinutes(startTime) + Math.max(0, Math.round(durationMinutes));
  return end >= 24 * 60 ? '' : fromMinutes(end);
}

export function checkMove(input: MoveInput): MoveCheck {
  const { date, startTime, durationMinutes } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const endTime = endTimeFor(startTime, durationMinutes);
  const changed = date !== input.from.date || startTime !== input.from.startTime;

  if (!DAY.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
    blockers.push('Choose a date.');
  }
  if (!TIME.test(startTime)) {
    blockers.push('Choose a start time.');
  } else if (!endTime) {
    blockers.push('The lesson would run past midnight. Choose an earlier start time.');
  }
  if (blockers.length) return { endTime, changed, blockers, warnings };
  if (!changed) return { endTime, changed, blockers: ['That is the date and time it already has.'], warnings };

  const startMin = toMinutes(startTime);
  const endMin = toMinutes(endTime);
  const others = input.dayLessons.filter((l) => l.id !== input.lessonId && l.status !== 'Cancelled');

  // A teacher cannot be in two places: another lesson at that time stops the move.
  for (const o of others) {
    if (o.startMin < endMin && o.endMin > startMin) {
      blockers.push(`${o.studentName || 'Another pupil'} already has a lesson from ${fromMinutes(o.startMin)} to ${fromMinutes(o.endMin)}.`);
    }
  }

  const startIso = new Date(`${date}T${startTime}:00`).toISOString();
  const endIso = new Date(`${date}T${endTime}:00`).toISOString();
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  if (input.blocks.some((b) => new Date(b.starts_at).getTime() < e && new Date(b.ends_at).getTime() > s)) {
    blockers.push('That time overlaps time you have marked as unavailable. Change or remove that first.');
  }
  if (blockers.length) return { endTime, changed, blockers, warnings };

  if (s < (input.now ?? new Date()).getTime()) warnings.push('That time has already passed.');

  const timed = (o: DayLesson): TimedLesson => ({ id: o.id, startMin: o.startMin, endMin: o.endMin, buffer: lessonBuffer(o) });
  const candidate: TimedLesson = { id: input.lessonId, startMin, endMin, buffer: lessonBuffer({ travel_minutes: input.travelMinutes }) };
  for (const t of findTightTurnarounds(candidate, others.map(timed))) {
    warnings.push(describeTightTurnaround(t, others.find((o) => o.id === t.otherId)?.studentName || ''));
  }
  return { endTime, changed, blockers, warnings };
}
