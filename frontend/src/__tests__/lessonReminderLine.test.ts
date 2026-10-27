import { lessonReminderLine } from '../lessonReminderLine';

const r = (status: any, channel?: any) => ({ status, kind: 'h48' as const, sent_at: '', delivered_at: null, read_at: null, channel });

describe('lessonReminderLine', () => {
  it('says so when no reminder has been sent', () => {
    expect(lessonReminderLine(null).text).toBe('No reminder sent yet');
  });

  it('describes each push state', () => {
    expect(lessonReminderLine(r('sent', 'push'))).toEqual({ text: 'Reminder sent — not yet delivered', color: '#EF4444' });
    expect(lessonReminderLine(r('delivered', 'push')).text).toBe('Reminder delivered — not yet read');
    expect(lessonReminderLine(r('read', 'push')).text).toBe('Reminder read');
  });

  it('treats an emailed reminder as final and healthy, but a failed one as failed', () => {
    expect(lessonReminderLine(r('sent', 'email'))).toEqual({ text: 'Reminder emailed', color: '#3B82F6' });
    expect(lessonReminderLine(r('failed', 'email')).text).toBe('Reminder failed to send');
    expect(lessonReminderLine(r('failed', 'push')).text).toBe('Reminder failed to send');
  });
});
