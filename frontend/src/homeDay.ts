type DayLesson = { start_time: string; end_time: string; status: string };

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** "Morning" until 12:00, "Afternoon" until 17:00, then "Evening". */
export function greetingFor(hour: number): string {
  return hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
}

export function firstNameOf(name: string | null | undefined): string {
  return (name || '').trim().split(/\s+/)[0] || 'there';
}

/** 20 -> "20 min", 65 -> "1 h 05", 120 -> "2 h". */
export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const m = min % 60;
  return m ? `${Math.floor(min / 60)} h ${String(m).padStart(2, '0')}` : `${Math.floor(min / 60)} h`;
}

export const TIGHT_GAP_MIN = 15;
export const LONG_GAP_MIN = 45;

/**
 * Time between each lesson and the next, as a travel/break line for the day timeline. Cancelled lessons are
 * ignored. Lessons must be sorted by start. A gap under TIGHT_GAP_MIN is tagged "Tight", one of LONG_GAP_MIN or more
 * "Free time"; overlapping lessons give no gap.
 */
export function gapsBetween<T extends DayLesson>(sorted: T[]): { after: T; minutes: number; tag: 'Tight' | 'Free time' | null }[] {
  const live = sorted.filter((l) => l.status !== 'Cancelled');
  const out: { after: T; minutes: number; tag: 'Tight' | 'Free time' | null }[] = [];
  for (let i = 0; i < live.length - 1; i++) {
    const minutes = toMin(live[i + 1].start_time) - toMin(live[i].end_time);
    if (minutes < 0) continue;
    out.push({ after: live[i], minutes, tag: minutes < TIGHT_GAP_MIN ? 'Tight' : minutes >= LONG_GAP_MIN ? 'Free time' : null });
  }
  return out;
}

/** Minutes of teaching, the number of lessons, and the total gap time, for the day's stat tiles. */
export function dayTotals<T extends DayLesson>(sorted: T[]): { teachMin: number; lessonCount: number; gapMin: number } {
  const live = sorted.filter((l) => l.status !== 'Cancelled');
  return {
    teachMin: live.reduce((sum, l) => sum + (toMin(l.end_time) - toMin(l.start_time)), 0),
    lessonCount: live.length,
    gapMin: gapsBetween(sorted).reduce((sum, g) => sum + g.minutes, 0),
  };
}
