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

// ---------------------------------------------------------------------------------------------------------------------
// A repeating lesson: "this and the lessons after it" all move by the same amount (the same number of days and the same
// number of minutes), so a Tuesday 10:00 series moved to Wednesday 14:00 becomes every Wednesday at 14:00 from then on.
// Each lesson is checked on its own day; the teacher sees every problem, by date, before anything is saved.
// ---------------------------------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYY-MM-DD plus a number of calendar days (negative goes back). Calendar days, so a clock change does not matter. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Whole calendar days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

/** "Tue 17 Nov". */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${DAY_NAMES[new Date(y, m - 1, d).getDay()]} ${d} ${MONTH_NAMES[m - 1]}`;
}

export type SeriesLesson = {
  id: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  travelMinutes?: number | null;
};

export type SeriesItem = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  blockers: string[];
  warnings: string[];
};

export type SeriesCheck = {
  items: SeriesItem[];
  /** Every blocker, each starting with the date it is about. */
  blockers: string[];
  warnings: string[];
};

export type SeriesMoveInput = {
  /** This lesson first, then the ones after it, in date order. */
  lessons: SeriesLesson[];
  /** Where the first lesson is going. The others move by the same amount. */
  date: string;
  startTime: string;
  /** Other lessons of the same instructor on each day they are moving to, keyed by YYYY-MM-DD. */
  dayLessonsByDate: Record<string, DayLesson[]>;
  blocks: TimeBlock[];
  now?: Date;
};

export function checkSeriesMove(input: SeriesMoveInput): SeriesCheck {
  const [first] = input.lessons;
  if (!first) return { items: [], blockers: ['There is nothing to move.'], warnings: [] };
  const dayDelta = DAY.test(input.date) ? daysBetween(first.date, input.date) : NaN;
  const minuteDelta = TIME.test(input.startTime) ? toMinutes(input.startTime) - toMinutes(first.startTime) : NaN;
  if (Number.isNaN(dayDelta)) return { items: [], blockers: ['Choose a date.'], warnings: [] };
  if (Number.isNaN(minuteDelta)) return { items: [], blockers: ['Choose a start time.'], warnings: [] };
  if (dayDelta === 0 && minuteDelta === 0) return { items: [], blockers: ['That is the date and time it already has.'], warnings: [] };

  // The lessons being moved do not count as clashes for each other, or for the places they are leaving.
  const moving = new Set(input.lessons.map((l) => l.id));
  const items: SeriesItem[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  for (const l of input.lessons) {
    const date = addDays(l.date, dayDelta);
    const startMin = toMinutes(l.startTime) + minuteDelta;
    const label = dayLabel(date);
    if (startMin < 0 || startMin >= 24 * 60) {
      const text = 'That start time would take the lesson out of the day.';
      items.push({ id: l.id, date, startTime: '', endTime: '', blockers: [text], warnings: [] });
      blockers.push(`${label}: ${text}`);
      continue;
    }
    const startTime = fromMinutes(startMin);
    const r = checkMove({
      lessonId: l.id, from: { date: l.date, startTime: l.startTime }, date, startTime, durationMinutes: l.durationMinutes,
      travelMinutes: l.travelMinutes, dayLessons: (input.dayLessonsByDate[date] || []).filter((o) => !moving.has(o.id)),
      blocks: input.blocks, now: input.now,
    });
    items.push({ id: l.id, date, startTime, endTime: r.endTime, blockers: r.blockers, warnings: r.warnings });
    r.blockers.forEach((b) => blockers.push(`${label}: ${b}`));
    r.warnings.forEach((w) => warnings.push(`${label}: ${w}`));
  }
  return { items, blockers, warnings };
}
