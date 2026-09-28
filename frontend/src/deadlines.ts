/**
 * Instructor deadline tracking — the pure logic (28 Sept 2026, Migration 046).
 *
 * No React, no network: everything here takes plain values so it can be unit
 * tested (see __tests__/deadlines.test.ts). The reminder EMAILS and pushes are
 * sent by backend/admin_reminders.py; the day thresholds here mirror its
 * stage_for() — 30, 7 and 1 days before, then overdue — so the colours in the
 * app and the reminders an instructor actually receives tell the same story.
 */

export type DeadlineKind =
  | 'adi_badge'
  | 'standards_check'
  | 'mot'
  | 'insurance'
  | 'road_tax'
  | 'dual_controls'
  | 'other';

/** Kinds an instructor can add or edit by hand. The standards check is derived
 *  from their logged checks (last + 4 years), so it is never typed in here. */
export type EditableDeadlineKind = Exclude<DeadlineKind, 'standards_check'>;

export const EDITABLE_KINDS: EditableDeadlineKind[] = [
  'adi_badge',
  'mot',
  'insurance',
  'road_tax',
  'dual_controls',
  'other',
];

export const KIND_INFO: Record<DeadlineKind, { label: string; hint: string }> = {
  adi_badge: { label: 'ADI badge renewal', hint: 'The date your ADI registration expires.' },
  standards_check: { label: 'DVSA standards check', hint: 'Worked out from your logged checks (last check + 4 years).' },
  mot: { label: 'MOT', hint: 'The date your MOT certificate expires.' },
  insurance: { label: 'Car insurance', hint: 'The date your policy renews.' },
  road_tax: { label: 'Road tax', hint: 'The date your vehicle tax runs out.' },
  dual_controls: { label: 'Dual-control service', hint: 'When your dual controls are next due a service.' },
  other: { label: 'Other', hint: 'Anything else with a date, like first aid or breakdown cover.' },
};

/** Days before the due date that a reminder is sent (matches the backend). */
export const REMIND_DAYS = [30, 7, 1] as const;

/** One row from the instructor_deadline_items view. */
export type DeadlineItem = {
  item_key: string;
  /** null for the derived standards check, which has no row of its own. */
  id: string | null;
  instructor_id: string;
  kind: DeadlineKind;
  label: string | null;
  due_date: string; // YYYY-MM-DD
  notes: string | null;
  derived: boolean;
};

// --- dates ------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict YYYY-MM-DD parse that also rejects impossible dates (2026-02-30). */
export function parseDateOnly(value: string): { y: number; m: number; d: number } | null {
  const match = ISO_DATE.exec((value || '').trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function isValidDateInput(value: string): boolean {
  return parseDateOnly(value) !== null;
}

/** Whole calendar days from today until the due date (negative once passed).
 *  Compares dates, not moments, so it doesn't flip halfway through the day. */
export function daysUntil(dueISO: string, today: Date = new Date()): number | null {
  const due = parseDateOnly(dueISO);
  if (!due) return null;
  const dueUtc = Date.UTC(due.y, due.m - 1, due.d);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((dueUtc - todayUtc) / 86_400_000);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. "Thu 8 Oct 2026". Built by hand so it reads the same on every device. */
export function formatDueDate(dueISO: string): string {
  const p = parseDateOnly(dueISO);
  if (!p) return dueISO;
  const weekday = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return `${weekday} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

// --- status -----------------------------------------------------------------

export type DeadlineStatus = 'overdue' | 'urgent' | 'soon' | 'ok';

/** overdue: passed | urgent: within a week | soon: within 30 days | ok: further off. */
export function statusForDays(days: number): DeadlineStatus {
  if (days < 0) return 'overdue';
  if (days <= 7) return 'urgent';
  if (days <= 30) return 'soon';
  return 'ok';
}

export function describeDays(days: number): string {
  if (days < -1) return `Overdue by ${Math.abs(days)} days`;
  if (days === -1) return 'Overdue by 1 day';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

// --- lists ------------------------------------------------------------------

export function itemDisplayName(item: Pick<DeadlineItem, 'kind' | 'label'>): string {
  const custom = (item.label || '').trim();
  if (item.kind === 'other' || custom) return custom || KIND_INFO.other.label;
  return KIND_INFO[item.kind]?.label ?? KIND_INFO.other.label;
}

/** Soonest first; overdue items naturally sort to the top. Items with an
 *  unreadable date go last rather than being dropped. */
export function sortByDueDate<T extends { due_date: string }>(items: T[], today: Date = new Date()): T[] {
  return [...items].sort((a, b) => {
    const da = daysUntil(a.due_date, today);
    const db = daysUntil(b.due_date, today);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
}

/** Everything that needs looking at now: overdue, or due within `withinDays`. */
export function needsAttention<T extends { due_date: string }>(
  items: T[],
  withinDays = 30,
  today: Date = new Date(),
): T[] {
  return sortByDueDate(
    items.filter((i) => {
      const d = daysUntil(i.due_date, today);
      return d !== null && d <= withinDays;
    }),
    today,
  );
}

/** Kinds still free to add: each standard kind can only be tracked once (the
 *  database enforces it), while "other" can repeat. */
export function availableKinds(existing: Array<Pick<DeadlineItem, 'kind'>>): EditableDeadlineKind[] {
  const used = new Set(existing.map((i) => i.kind));
  return EDITABLE_KINDS.filter((k) => k === 'other' || !used.has(k));
}

/** One line for the Home card: "MOT due in 5 days" or "2 deadlines need attention". */
export function attentionSummary(items: DeadlineItem[], today: Date = new Date()): string | null {
  const list = needsAttention(items, 30, today);
  if (list.length === 0) return null;
  if (list.length === 1) {
    const d = daysUntil(list[0].due_date, today);
    const name = itemDisplayName(list[0]);
    return d === null ? name : `${name}: ${describeDays(d).toLowerCase()}`;
  }
  return `${list.length} deadlines need attention`;
}
