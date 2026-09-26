// Picks and describes a student's next upcoming lesson for the student home
// screen. Pure (no network, no supabase import) so it can be unit tested.
//
// Lesson `date` ("YYYY-MM-DD"), `start_time` and `end_time` ("HH:mm") are already
// in the device's local time (supabaseDb.tsToParts uses local getters), so they
// are compared against a local `now` here.

export type LessonLike = {
  date: string;
  start_time: string;
  end_time: string;
  status: string;
};

export type LessonWhen = {
  /** "Today", "Tomorrow", or e.g. "Tue 30 Sep" */
  day: string;
  /** e.g. "14:00–15:00" */
  time: string;
  /** true while the lesson is underway (start <= now < end) */
  inProgress: boolean;
};

function parseLocal(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  const t = /^(\d{1,2}):(\d{2})/.exec(time || '');
  if (!d || !t) return null;
  const out = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** Start and end of a lesson as local Dates, or null if the row is unusable. */
export function lessonBounds(l: LessonLike): { start: Date; end: Date } | null {
  const start = parseLocal(l.date, l.start_time);
  if (!start) return null;
  const parsedEnd = parseLocal(l.date, l.end_time);
  // A missing/garbled end time shouldn't hide the lesson: treat it as ending when it starts.
  const end = parsedEnd && parsedEnd.getTime() > start.getTime() ? parsedEnd : start;
  return { start, end };
}

/**
 * The student's next lesson: the earliest Scheduled lesson that hasn't finished
 * yet. Cancelled and Completed lessons are never "next"; a lesson that is
 * underway right now still counts (so it shows as "Happening now").
 * Input order doesn't matter.
 */
export function nextUpcomingLesson<T extends LessonLike>(lessons: T[], now: Date = new Date()): T | undefined {
  let best: { lesson: T; startMs: number } | undefined;
  for (const lesson of lessons) {
    if (lesson.status !== 'Scheduled') continue;
    const b = lessonBounds(lesson);
    if (!b || b.end.getTime() <= now.getTime()) continue;
    if (!best || b.start.getTime() < best.startMs) best = { lesson, startMs: b.start.getTime() };
  }
  return best?.lesson;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function describeLessonWhen(l: LessonLike, now: Date = new Date()): LessonWhen | null {
  const b = lessonBounds(l);
  if (!b) return null;

  const dayDiff = Math.round((startOfDay(b.start) - startOfDay(now)) / 86_400_000);
  const day =
    dayDiff === 0 ? 'Today'
      : dayDiff === 1 ? 'Tomorrow'
      : b.start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  const hhmm = (s: string) => s.slice(0, 5).padStart(5, '0');
  const time = b.end.getTime() > b.start.getTime()
    ? `${hhmm(l.start_time)}–${hhmm(l.end_time)}`
    : hhmm(l.start_time);

  return {
    day,
    time,
    inProgress: b.start.getTime() <= now.getTime() && now.getTime() < b.end.getTime(),
  };
}
