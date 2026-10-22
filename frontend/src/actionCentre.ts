// The Action Centre: one "what needs me today" list built from data the app already holds. Pure logic, no network,
// so each rule is unit tested (see __tests__/actionCentre.test.ts). Thresholds are the defaults agreed with Grant.
import { daysUntil, describeDays, itemDisplayName, needsAttention, type DeadlineItem } from './deadlines';
import { isHavingLessons, hasLowCredit } from './studentGlance';
import { formatHoursLabel } from './voucher';
import type { BriefItem } from './roadBriefing';
import { stageOf, daysInStage, WAITING_NUDGE_DAYS } from './waitlistPipeline';

/** Active pupil with no lesson this long and nothing booked is flagged as inactive. */
export const INACTIVE_AFTER_DAYS = 14;
/** A practical test this close counts as upcoming. */
export const TEST_WITHIN_DAYS = 14;
/** Cancellations from this far back (and any still ahead) are listed, so a freed slot can be refilled. */
export const CANCELLED_LOOKBACK_DAYS = 7;
/** Deadlines overdue or due within this many days (matches the reminder emails). */
export const DEADLINE_WITHIN_DAYS = 30;

export type ActionGroup = 'overdue_lessons' | 'road' | 'cancellations' | 'tests' | 'deadlines' | 'low_wallet' | 'inactive' | 'waiting_list';

export const GROUP_ORDER: ActionGroup[] = ['overdue_lessons', 'road', 'cancellations', 'tests', 'deadlines', 'low_wallet', 'inactive', 'waiting_list'];

export const GROUP_TITLES: Record<ActionGroup, string> = {
  overdue_lessons: 'Lessons to wrap up',
  road: 'On the road today',
  cancellations: 'Cancellations',
  tests: 'Upcoming tests',
  deadlines: 'Your deadlines',
  low_wallet: 'Low prepaid hours',
  inactive: 'Pupils gone quiet',
  waiting_list: 'Waiting list',
};

/** Where tapping an item goes. */
export type ActionTarget =
  | { screen: 'student'; studentId: string }
  | { screen: 'diary'; date?: string }
  | { screen: 'deadlines' };

export type ActionItem = {
  key: string;
  group: ActionGroup;
  title: string;
  detail: string;
  /** Urgent items (an overdue deadline, a test within 3 days) sort first and are highlighted. */
  urgent: boolean;
  target: ActionTarget;
};

type StudentLike = {
  id: string; name: string; status?: string | null; test_date?: string | null; next_lesson?: string | null;
  waitlist_stage?: string | null; waitlist_stage_at?: string | null;
};
type LessonLike = {
  id: string; student_id: string; date: string; start_time: string; end_time: string; status?: string | null;
  cancellation_charge?: number | null;
};

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function at(date: string, hhmm: string): Date | null {
  const [y, m, d] = (date || '').split('-').map(Number);
  const [h, mi] = (hhmm || '').split(':').map(Number);
  if (![y, m, d, h, mi].every(Number.isFinite)) return null;
  return new Date(y, m - 1, d, h, mi);
}

/** "Tue 21 Oct" */
export function shortDay(date: string): string {
  const d = at(date, '00:00');
  return d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : date;
}

function wholeDaysBetween(from: string, to: Date): number {
  const f = at(from, '00:00');
  if (!f) return 0;
  const t = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((t.getTime() - f.getTime()) / DAY_MS);
}

export function buildActionItems(input: {
  now: Date;
  students: StudentLike[];
  lessons: LessonLike[];
  hoursBalances: Record<string, number | undefined>;
  deadlines: DeadlineItem[];
  /** Today's road briefing lines (late or tight changeovers, weather), for paid plans. */
  roadItems?: BriefItem[];
}): ActionItem[] {
  const { now, students, lessons, hoursBalances, deadlines, roadItems = [] } = input;
  const items: ActionItem[] = [];
  const nameOf = new Map(students.map((s) => [s.id, s.name]));
  const who = (id: string) => nameOf.get(id) || 'A pupil';
  const today = dayKey(now);

  // 1. Lessons whose time has passed but were never marked completed or cancelled.
  for (const l of lessons) {
    if (l.status === 'Completed' || l.status === 'Cancelled') continue;
    const end = at(l.date, l.end_time);
    if (!end || end.getTime() >= now.getTime()) continue;
    items.push({
      key: `overdue-${l.id}`, group: 'overdue_lessons', urgent: false,
      title: `${who(l.student_id)}: lesson not marked complete`,
      detail: `${shortDay(l.date)}, ${l.start_time} to ${l.end_time}. Log how it went.`,
      target: { screen: 'diary', date: l.date },
    });
  }

  // 1b. Today's road briefing: lessons you may be late for, tight changeovers, weather to watch.
  for (const r of roadItems) {
    items.push({
      key: `road-${r.key}`, group: 'road', urgent: r.severity === 'warn',
      title: r.title, detail: r.detail, target: { screen: 'diary' },
    });
  }

  // 2. Cancelled lessons from the last week, and any still ahead (a freed slot to refill).
  const earliest = new Date(now.getTime() - CANCELLED_LOOKBACK_DAYS * DAY_MS);
  for (const l of lessons) {
    if (l.status !== 'Cancelled') continue;
    const start = at(l.date, l.start_time);
    if (!start || start.getTime() < earliest.getTime()) continue;
    const ahead = start.getTime() >= now.getTime();
    const charge = Number(l.cancellation_charge);
    items.push({
      key: `cancelled-${l.id}`, group: 'cancellations', urgent: false,
      title: `${who(l.student_id)} cancelled`,
      detail: `${shortDay(l.date)}, ${l.start_time}.${ahead ? ' The slot is free to rebook.' : ''}${Number.isFinite(charge) && charge > 0 ? ` Cancellation charge £${charge}.` : ''}`,
      target: { screen: 'diary', date: l.date },
    });
  }

  // 3. Practical tests coming up.
  for (const s of students) {
    if (s.status === 'Passed' || !s.test_date) continue;
    const d = daysUntil(String(s.test_date).slice(0, 10), now);
    if (d === null || d < 0 || d > TEST_WITHIN_DAYS) continue;
    items.push({
      key: `test-${s.id}`, group: 'tests', urgent: d <= 3,
      title: `${s.name}: practical test ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}`,
      detail: shortDay(String(s.test_date).slice(0, 10)),
      target: { screen: 'student', studentId: s.id },
    });
  }

  // 4. The instructor's own deadlines.
  for (const dl of needsAttention(deadlines, DEADLINE_WITHIN_DAYS, now)) {
    const d = daysUntil(dl.due_date, now);
    items.push({
      key: `deadline-${dl.item_key}`, group: 'deadlines', urgent: d !== null && d < 0,
      title: itemDisplayName(dl),
      detail: d === null ? dl.due_date : describeDays(d),
      target: { screen: 'deadlines' },
    });
  }

  // 5. Low prepaid hours.
  for (const s of students) {
    if (!hasLowCredit(s, hoursBalances)) continue;
    items.push({
      key: `wallet-${s.id}`, group: 'low_wallet', urgent: false,
      title: `${s.name}: low prepaid hours`,
      detail: `${formatHoursLabel(hoursBalances[s.id] ?? 0)} left`,
      target: { screen: 'student', studentId: s.id },
    });
  }

  // 6. Pupils who are having lessons but have gone quiet: nothing in the last two weeks and nothing booked.
  const lastDone = new Map<string, string>();
  const booked = new Set<string>();
  for (const l of lessons) {
    if (l.status === 'Completed') {
      if (!lastDone.get(l.student_id) || l.date > (lastDone.get(l.student_id) as string)) lastDone.set(l.student_id, l.date);
    } else if (l.status !== 'Cancelled' && l.date >= today) {
      booked.add(l.student_id);
    }
  }
  for (const s of students) {
    if (!isHavingLessons(s.status) || booked.has(s.id)) continue;
    const last = lastDone.get(s.id);
    const gap = last ? wholeDaysBetween(last, now) : null;
    if (gap !== null && gap < INACTIVE_AFTER_DAYS) continue;
    items.push({
      key: `inactive-${s.id}`, group: 'inactive', urgent: false,
      title: `${s.name}: nothing booked`,
      detail: last ? `Last lesson ${gap} days ago.` : `No lesson in the last ${CHECKED_WINDOW_DAYS} days.`,
      target: { screen: 'student', studentId: s.id },
    });
  }

  // 7. Waiting list: left in Waiting for a week, or marked Booked with no lesson in the diary.
  for (const s of students) {
    const stage = stageOf(s);
    if (stage === 'Waiting') {
      const d = daysInStage(s, now);
      if (d === null || d < WAITING_NUDGE_DAYS) continue;
      items.push({
        key: `waiting-${s.id}`, group: 'waiting_list', urgent: false,
        title: `${s.name}: waiting ${d} days`,
        detail: 'Not contacted yet. Get in touch, or move them along.',
        target: { screen: 'student', studentId: s.id },
      });
    } else if (stage === 'Booked' && !booked.has(s.id)) {
      items.push({
        key: `waitbooked-${s.id}`, group: 'waiting_list', urgent: false,
        title: `${s.name}: marked Booked, no lesson in the diary`,
        detail: 'Add their first lesson, or move them back.',
        target: { screen: 'student', studentId: s.id },
      });
    }
  }

  // Urgent first, then by group order, keeping each group's own order.
  const rank = (g: ActionGroup) => GROUP_ORDER.indexOf(g);
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => Number(b.it.urgent) - Number(a.it.urgent) || rank(a.it.group) - rank(b.it.group) || a.i - b.i)
    .map((x) => x.it);
}

/** How far back the lesson data used by the Action Centre reaches (so "no lesson" is only claimed within it). */
export const CHECKED_WINDOW_DAYS = 30;
/** How far ahead (so "nothing booked" looks at upcoming lessons too). */
export const AHEAD_WINDOW_DAYS = 30;

/** Items grouped in display order, empty groups left out. */
export function groupActionItems(items: ActionItem[]): { group: ActionGroup; title: string; items: ActionItem[] }[] {
  return GROUP_ORDER
    .map((g) => ({ group: g, title: GROUP_TITLES[g], items: items.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);
}

/** The one line for the Home card. */
export function actionSummary(count: number): string {
  if (count === 0) return "You're all caught up";
  return count === 1 ? '1 thing needs you' : `${count} things need you`;
}
