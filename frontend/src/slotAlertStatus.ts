// What to tell an instructor about the slot alert for one of their cancelled lessons. The rules
// mirror backend/slot_alerts.py: slots under MIN_NOTICE_MIN away or over LOOKAHEAD_DAYS ahead are
// never announced, and a cancellation is announced within a few minutes (the job only looks at
// lessons changed in the last RECENT_MIN minutes). Kept apart from the screen so it can be tested.

export const MIN_NOTICE_MIN = 120;
export const LOOKAHEAD_DAYS = 14;
export const RECENT_MIN = 30;

/** What slot_alert_status() returns. null means the lesson is not the caller's. */
export type SlotAlertStatus = {
  sent_at: string | null;
  lesson_updated_at: string | null;
  told: number;
} | null;

/**
 * One line for the cancelled lesson, or null when there is nothing worth saying: not on a paid
 * plan (no alerts are sent), a slot already in the past, or an old cancellation from before slot
 * alerts that will never be announced.
 */
export function describeSlotAlert(
  status: SlotAlertStatus,
  lessonStartMs: number,
  nowMs: number,
  paid: boolean,
): string | null {
  if (!paid || !status || !Number.isFinite(lessonStartMs)) return null;
  const minutesAway = (lessonStartMs - nowMs) / 60_000;
  if (minutesAway <= 0) return null;

  if (status.sent_at) {
    if (status.told <= 0) return 'Slot alert sent: no pupil needed telling (none had alerts on, or they were all busy at that time).';
    return `Slot alert sent to ${status.told} pupil${status.told === 1 ? '' : 's'}.`;
  }
  if (minutesAway < MIN_NOTICE_MIN) return 'No slot alert: the slot is less than 2 hours away.';
  if (minutesAway > LOOKAHEAD_DAYS * 24 * 60) return `No slot alert: the slot is more than ${LOOKAHEAD_DAYS} days away.`;

  const changed = status.lesson_updated_at ? Date.parse(status.lesson_updated_at) : NaN;
  if (Number.isFinite(changed) && nowMs - changed <= (RECENT_MIN + 5) * 60_000) {
    return 'Slot alert: pupils with alerts on are being told within a few minutes.';
  }
  return null; // an old cancellation that will not be announced
}
