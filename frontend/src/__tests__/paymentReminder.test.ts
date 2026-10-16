const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../api', () => ({ api: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) } }));

import {
  getReminderStatus, sendPaymentReminder, reminderErrorMessage, reminderSuccessMessage, reminderHistoryLine,
} from '../paymentReminder';

beforeEach(() => { mockGet.mockReset(); mockPost.mockReset(); });

describe('calls', () => {
  it('asks the backend whether a reminder can be sent', async () => {
    mockGet.mockResolvedValue({ data: { owes: 46, can_send: true, reachable: true, last_sent_at: null, next_allowed_at: null } });
    expect((await getReminderStatus('s1')).can_send).toBe(true);
    expect(mockGet).toHaveBeenCalledWith('/payments/reminder-status', { params: { student_id: 's1' } });
  });

  it('sends one', async () => {
    mockPost.mockResolvedValue({ data: { sent: true, channel: 'email', owes: 46 } });
    expect((await sendPaymentReminder('s1')).channel).toBe('email');
    expect(mockPost).toHaveBeenCalledWith('/payments/remind', { student_id: 's1' });
  });
});

describe('wording', () => {
  it('shows the backend’s refusal as it is, and a plain message otherwise', () => {
    expect(reminderErrorMessage({ response: { data: { detail: 'Sam has no app login or email address I can reach.' } } })).toMatch(/no app login/);
    expect(reminderErrorMessage(new Error('Network Error'))).toMatch(/Check your connection/);
    expect(reminderErrorMessage({ response: { data: { detail: '  ' } } })).toMatch(/Check your connection/);
    expect(reminderErrorMessage(null)).toMatch(/Check your connection/);
  });

  it('says how the reminder went', () => {
    expect(reminderSuccessMessage('Sam', 'push')).toBe('Reminder sent to Sam as a notification on their phone.');
    expect(reminderSuccessMessage('Sam', 'email')).toBe('Reminder sent to Sam by email.');
    expect(reminderSuccessMessage('', 'email')).toBe('Reminder sent to the pupil by email.');
  });

  it('says when the last one went and when the next may', () => {
    const base = { owes: 10, reachable: true };
    expect(reminderHistoryLine(null)).toBe('');
    expect(reminderHistoryLine({ ...base, can_send: true, last_sent_at: null, next_allowed_at: null })).toBe('');
    expect(reminderHistoryLine({ ...base, can_send: false, last_sent_at: '2026-10-14T09:00:00Z', next_allowed_at: '2026-10-17T09:00:00Z' }))
      .toBe('Last reminded 14 Oct. You can send another from 17 Oct.');
    expect(reminderHistoryLine({ ...base, can_send: true, last_sent_at: '2026-10-01T09:00:00Z', next_allowed_at: '2026-10-04T09:00:00Z' }))
      .toBe('Last reminded 1 Oct.');
  });
});
