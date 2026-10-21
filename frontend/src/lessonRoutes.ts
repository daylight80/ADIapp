// Which recorded route belongs to which lesson. A route recorded from a lesson's own tools carries that lesson's
// id. One recorded from the pupil's profile has no lesson, so it is matched to the pupil's lesson on the same day
// that started closest to when the recording began. A route that matches nothing stays on the pupil's profile.
import type { SavedRoute } from './routeRecorder';

type LessonLike = { id: string; date: string; start_time: string; status?: string | null };

/** The local calendar day (YYYY-MM-DD) and minutes past midnight of an ISO time, or null if unreadable. */
export function localDayAndMinutes(iso: string): { day: string; minutes: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes() };
}

function lessonStartMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function matchRoutesToLessons(
  lessons: LessonLike[],
  routes: SavedRoute[],
): { byLesson: Record<string, SavedRoute[]>; unmatched: SavedRoute[] } {
  const byLesson: Record<string, SavedRoute[]> = {};
  const unmatched: SavedRoute[] = [];
  const ids = new Set(lessons.map((l) => l.id));
  const live = lessons.filter((l) => l.status !== 'Cancelled');

  for (const r of routes) {
    let target: string | null = null;
    if (r.lessonId && ids.has(r.lessonId)) {
      target = r.lessonId;
    } else {
      const when = localDayAndMinutes(r.startedAt);
      if (when) {
        let best: { id: string; gap: number } | null = null;
        for (const l of live) {
          if (l.date !== when.day) continue;
          const start = lessonStartMinutes(l.start_time);
          const gap = start == null ? Number.MAX_SAFE_INTEGER - 1 : Math.abs(start - when.minutes);
          if (!best || gap < best.gap) best = { id: l.id, gap };
        }
        if (best) target = best.id;
      }
    }
    if (target) (byLesson[target] ||= []).push(r);
    else unmatched.push(r);
  }
  for (const k of Object.keys(byLesson)) byLesson[k].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return { byLesson, unmatched };
}
