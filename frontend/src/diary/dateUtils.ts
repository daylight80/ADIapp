/**
 * Lesson Diary — pure date & time helpers.
 * No React, no styling — easy to unit-test if/when needed.
 */

export function startOfWeek(d: Date): Date {
  const c = new Date(d);
  const day = c.getDay();
  const diff = (day + 6) % 7; // Monday = 0
  c.setDate(c.getDate() - diff);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function formatDateRange(start: Date): string {
  const end = addDays(start, 6);
  const m = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${m(start)} - ${m(end)}`;
}

/** Convert 'HH:MM' to total minutes since midnight. Returns 0 for malformed input. */
export function toMin(hhmm: string): number {
  const [h, m] = (hhmm || '').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Inverse of toMin — total minutes since midnight back to 'HH:MM'. Wraps
 * within a single day (0-1439), which is fine since lessons never span
 * midnight in this app. */
export function minutesToTime(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Round to the nearest `step` minutes — used when dragging a lesson so it
 * lands on a clean time (e.g. 14:05, not 14:03). */
export function snapMinutes(minutes: number, step = 5): number {
  return Math.round(minutes / step) * step;
}

/** First day of the calendar month containing d, time zeroed. */
export function startOfMonth(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), 1);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** The Monday on/before the 1st of the month — start of a clean 6-row grid. */
export function startOfMonthGrid(d: Date): Date {
  return startOfWeek(startOfMonth(d));
}

/** Always 42 days (6 full weeks) so the grid height never jumps between
 * months — some months only need 5 rows, but a fixed 6 keeps the layout
 * stable as the user pages back and forth. */
export function endOfMonthGrid(d: Date): Date {
  return addDays(startOfMonthGrid(d), 42);
}

export function addMonths(d: Date, n: number): Date {
  const c = new Date(d);
  c.setMonth(c.getMonth() + n);
  return c;
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** YYYY-MM-DD key for a Date in the local TZ (matches Supabase lesson.date). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export type ColumnAssignment = { column: number; totalColumns: number };

/**
 * Assigns a column (0, 1, 2...) to each item in a same-day list of
 * {id, startMin, endMin} entries, so that mutually-overlapping items can
 * be rendered side-by-side instead of on top of each other — the same
 * approach most calendar apps use for double-booked slots. Non-overlapping
 * items each get their own column of 1 (the common case, rendered full
 * width). `items` must already be sorted by start time.
 *
 * Extracted (25 Aug 2026) from the Day view diary screen so this genuinely
 * important layout logic — easy to get subtly wrong — has real, isolated
 * test coverage rather than living untested inside a render function.
 */
export function assignOverlapColumns(
  items: { id: string; startMin: number; endMin: number }[],
): Record<string, ColumnAssignment> {
  const assignment: Record<string, ColumnAssignment> = {};
  let clusterEnd = -Infinity;
  let cluster: typeof items = [];
  const clusters: (typeof items)[] = [];

  for (const it of items) {
    if (it.startMin >= clusterEnd) {
      if (cluster.length) clusters.push(cluster);
      cluster = [];
      clusterEnd = it.endMin;
    } else {
      clusterEnd = Math.max(clusterEnd, it.endMin);
    }
    cluster.push(it);
  }
  if (cluster.length) clusters.push(cluster);

  for (const group of clusters) {
    const columnEnds: number[] = []; // end time of the last item placed in each column
    for (const it of group) {
      let col = columnEnds.findIndex((endTime) => endTime <= it.startMin);
      if (col === -1) { col = columnEnds.length; columnEnds.push(it.endMin); }
      else columnEnds[col] = it.endMin;
      assignment[it.id] = { column: col, totalColumns: 0 }; // totalColumns filled in below
    }
    const totalColumns = columnEnds.length;
    for (const it of group) assignment[it.id].totalColumns = totalColumns;
  }
  return assignment;
}

/**
 * Finds groups of lessons that overlap in time on the same date — a
 * "persistent Fix clash" feature for the diary (2 Sept 2026), per Grant
 * directly, catching clashes that already exist in the schedule rather
 * than checking a lesson being added/moved right now (that's a separate,
 * already-existing check in AddLessonSheet/handleLessonDrop). Existing
 * clashes shouldn't normally happen given that check, but can slip
 * through via legacy data, migrations, or edge cases that check doesn't
 * cover — this is a safety net, not a duplicate of it.
 *
 * Takes a minimal, generic shape (not the full Lesson type) to stay pure
 * and easily testable, matching assignOverlapColumns above. Cancelled
 * lessons are the caller's responsibility to filter out beforehand —
 * this function has no opinion on lesson status.
 *
 * Returns each clashing group as an array of 2+ ids, grouped by date.
 * Lessons with no overlap at all are omitted entirely, not returned as
 * singleton groups.
 */
export function findClashingLessons(
  lessons: { id: string; date: string; startMin: number; endMin: number }[],
): string[][] {
  const byDate = new Map<string, typeof lessons>();
  for (const l of lessons) {
    const arr = byDate.get(l.date);
    if (arr) arr.push(l);
    else byDate.set(l.date, [l]);
  }

  const groups: string[][] = [];
  for (const dayLessons of byDate.values()) {
    const sorted = [...dayLessons].sort((a, b) => a.startMin - b.startMin);
    let clusterEnd = -Infinity;
    let cluster: typeof sorted = [];
    for (const it of sorted) {
      if (it.startMin >= clusterEnd) {
        if (cluster.length > 1) groups.push(cluster.map((c) => c.id));
        cluster = [];
        clusterEnd = it.endMin;
      } else {
        clusterEnd = Math.max(clusterEnd, it.endMin);
      }
      cluster.push(it);
    }
    if (cluster.length > 1) groups.push(cluster.map((c) => c.id));
  }
  return groups;
}
