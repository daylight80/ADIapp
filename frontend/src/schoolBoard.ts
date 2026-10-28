export type BoardRow = {
  instructor_id: string; full_name: string;
  students_active: number; lessons_month: number; revenue_month: number; pass_rate: number;
};
export type BoardSort = 'revenue_month' | 'lessons_month' | 'students_active' | 'pass_rate';

export const BOARD_SORTS: { key: BoardSort; label: string }[] = [
  { key: 'revenue_month', label: 'Revenue' },
  { key: 'lessons_month', label: 'Lessons' },
  { key: 'students_active', label: 'Students' },
  { key: 'pass_rate', label: 'Pass rate' },
];

/** Highest first; ties keep their order. */
export function sortBoard<T extends BoardRow>(rows: T[], key: BoardSort): T[] {
  return [...rows].sort((a, b) => b[key] - a[key]);
}

/** A row's bar width, 0 to 100, against the best row for that measure. Pass rate is already a percentage. */
export function boardBarPct(value: number, key: BoardSort, rows: BoardRow[]): number {
  const max = key === 'pass_rate' ? 100 : Math.max(1, ...rows.map((r) => r[key]));
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

/** The figure a row leads with for the chosen sort. Revenue is masked while hidden. */
export function boardMain(row: BoardRow, key: BoardSort, hidden: boolean): string {
  if (key === 'revenue_month') return hidden ? '£•••' : `£${row.revenue_month.toFixed(0)}`;
  if (key === 'pass_rate') return `${row.pass_rate}%`;
  return String(row[key]);
}

/** The other measures, as one line under the name. Revenue is left out while hidden. */
export function boardSub(row: BoardRow, key: BoardSort, hidden: boolean): string {
  const parts: [BoardSort, string][] = [
    ['revenue_month', hidden ? '' : `£${row.revenue_month.toFixed(0)}`],
    ['lessons_month', `${row.lessons_month} lessons`],
    ['students_active', `${row.students_active} students`],
    ['pass_rate', `${row.pass_rate}% pass`],
  ];
  return parts.filter(([k, text]) => k !== key && text).map(([, text]) => text).join(' · ');
}

/** The two revenue bars: this month full width unless last month was bigger, last month in proportion. */
export function revenueBars(current: number, previous: number): { currentPct: number; previousPct: number } {
  const max = Math.max(current, previous);
  if (max <= 0) return { currentPct: 0, previousPct: 0 };
  return { currentPct: Math.round((current / max) * 100), previousPct: Math.round((previous / max) * 100) };
}

/** Lessons today (not cancelled), the instructors working, and how many are done. */
export function todayTotals(lessons: { instructor_id: string; status: string }[]): { lessons: number; instructors: number; done: number } {
  const live = lessons.filter((l) => l.status !== 'Cancelled');
  return {
    lessons: live.length,
    instructors: new Set(live.map((l) => l.instructor_id)).size,
    done: live.filter((l) => l.status === 'Completed').length,
  };
}
