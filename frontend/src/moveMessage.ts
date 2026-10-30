import { dayLabel } from './diary/moveLesson';

/** What a teacher can send a pupil, by text or WhatsApp, after moving their lesson. */
export function moveMessage(pupilName: string, change: { date: string; startTime: string; count: number }): string {
  const first = (pupilName || '').trim().split(' ')[0] || 'there';
  const when = `${dayLabel(change.date)} at ${change.startTime}`;
  return change.count > 1
    ? `Hi ${first}, I've moved your lessons. The next one is now ${when}, and the ones after it have moved by the same amount. Let me know if that doesn't work for you.`
    : `Hi ${first}, I've moved your lesson to ${when}. Let me know if that doesn't work for you.`;
}
