// The "Send payment reminder" button on a pupil who owes money: the calls to the backend and the wording.
// The backend sends a push, or an email when the pupil has no app, and allows one reminder per pupil every
// few days (migration 073). Nothing is sent without the instructor tapping the button.
import { api } from './api';

export type ReminderStatus = {
  owes: number;
  can_send: boolean;
  reachable: boolean;
  last_sent_at: string | null;
  next_allowed_at: string | null;
};

export type ReminderResult = { sent: boolean; channel: 'push' | 'email'; owes: number };

export async function getReminderStatus(studentId: string): Promise<ReminderStatus> {
  const res = await api.get('/payments/reminder-status', { params: { student_id: studentId } });
  return res.data as ReminderStatus;
}

export async function sendPaymentReminder(studentId: string): Promise<ReminderResult> {
  const res = await api.post('/payments/remind', { student_id: studentId });
  return res.data as ReminderResult;
}

/** The backend words its refusals for the instructor (already sent recently, no way to reach them); show those as they are. */
export function reminderErrorMessage(e: unknown): string {
  const detail = (e as any)?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  return "Couldn't send the reminder. Check your connection and try again.";
}

export function reminderSuccessMessage(pupilFirstName: string, channel: 'push' | 'email'): string {
  const name = pupilFirstName || 'the pupil';
  return channel === 'push'
    ? `Reminder sent to ${name} as a notification on their phone.`
    : `Reminder sent to ${name} by email.`;
}

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
};

/** "Last reminded 14 Oct. You can send another from 17 Oct." Empty when none has been sent. */
export function reminderHistoryLine(status: ReminderStatus | null | undefined): string {
  if (!status?.last_sent_at) return '';
  const last = `Last reminded ${day(status.last_sent_at)}.`;
  if (status.can_send || !status.next_allowed_at) return last;
  return `${last} You can send another from ${day(status.next_allowed_at)}.`;
}
