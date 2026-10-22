import type { PendingWrite } from './offlineQueue';

const NAMES: Record<string, string> = {
  date: 'Date', start_time: 'Start', end_time: 'End', status: 'Status', topic: 'Topic', lesson_type: 'Type',
  pickup_address: 'Pick-up', test_centre: 'Test centre', travel_minutes: 'Travel (min)', notes: 'Notes',
  driving_faults: 'Driving faults', serious_faults: 'Serious faults', dangerous_faults: 'Dangerous faults', grade: 'Grade',
  amount_paid: 'Amount paid', quoted_amount: 'Quoted', pre_check_completed_at: 'Pre-check',
  cancellation_charge: 'Cancellation charge', cancellation_note: 'Cancellation note',
};

const show = (v: unknown) => (v === null || v === undefined || v === '' ? 'empty' : String(v));

/** Plain-English lines saying what differs between this queued change and the lesson as it is now on the server. */
export function conflictLines(w: Pick<PendingWrite, 'payload' | 'conflict' | 'base'>): string[] {
  const c = w.conflict;
  if (!c) return [];
  if (c.kind === 'deleted') return ['This lesson was deleted on another device.'];
  const payload = w.payload as Record<string, unknown>;
  const theirs = (c.theirs ?? {}) as Record<string, unknown>;
  const base = (w.base ?? {}) as Record<string, unknown>;
  return Object.keys(theirs)
    // Only the fields someone else changed, not every field this change happens to touch.
    .filter((k) => NAMES[k] && String(base[k] ?? '') !== String(theirs[k] ?? ''))
    .map((k) => `${NAMES[k]}: yours ${show(payload[k])}, now ${show(theirs[k])}`);
}
