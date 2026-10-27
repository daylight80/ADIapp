import type { LessonReminderStatus } from './supabaseDb';

/** Wording and dot colour for the reminder line on a pupil's next lesson. `null` status means none has been sent. */
export function lessonReminderLine(r: LessonReminderStatus | null): { text: string; color: string } {
  if (!r) return { text: 'No reminder sent yet', color: '#9CA3AF' };
  // An emailed reminder can never become delivered/read (no email receipts), so 'sent' is its final, healthy
  // state: blue, not the red used for a push that has not been delivered yet.
  if (r.status === 'failed') return { text: 'Reminder failed to send', color: '#EF4444' };
  if (r.channel === 'email') return { text: 'Reminder emailed', color: '#3B82F6' };
  if (r.status === 'read') return { text: 'Reminder read', color: '#10B981' };
  if (r.status === 'delivered') return { text: 'Reminder delivered — not yet read', color: '#F59E0B' };
  return { text: 'Reminder sent — not yet delivered', color: '#EF4444' };
}
