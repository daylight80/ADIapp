import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../BottomSheet', () => ({ BottomSheet: ({ visible, children, testID }: any) => {
  const { View } = require('react-native');
  return visible ? <View testID={testID}>{children}</View> : null;
} }));
const mockCall = jest.fn();
jest.mock('../backendCall', () => ({ callBackend: (...a: any[]) => mockCall(...a) }));
const mockSms = jest.fn();
const mockWa = jest.fn();
jest.mock('../tools', () => ({ openSmsComposer: (...a: any[]) => mockSms(...a), openWhatsApp: (...a: any[]) => mockWa(...a) }));

import { TellPupilSheet } from '../TellPupilSheet';
import { moveMessage } from '../moveMessage';

const moved = { lessonId: 'l1', date: '2099-11-04', startTime: '14:00', count: 1, queued: false };
const onDone = jest.fn();
const open = async (over: object = {}, phone: string | null = '07700900123') => {
  await render(<TellPupilSheet moved={{ ...moved, ...over }} pupilName="Sam Lee" pupilPhone={phone ?? undefined} onDone={onDone} />);
};
beforeEach(() => { mockCall.mockReset(); mockSms.mockReset(); mockWa.mockReset(); onDone.mockReset(); mockCall.mockResolvedValue({ notified: true }); });

describe('moveMessage', () => {
  it('names the new day and time for one lesson', () => {
    expect(moveMessage('Sam Lee', { date: '2099-11-04', startTime: '14:00', count: 1 })).toBe(
      "Hi Sam, I've moved your lesson to Wed 4 Nov at 14:00. Let me know if that doesn't work for you.");
  });
  it('says the later ones moved too when it was a series', () => {
    expect(moveMessage('Sam Lee', { date: '2099-11-04', startTime: '14:00', count: 3 })).toMatch(/moved your lessons.*next one is now Wed 4 Nov at 14:00.*the ones after it have moved by the same amount/);
  });
});

describe('Tell the pupil', () => {
  it('shows nothing when no lesson was moved', async () => {
    await render(<TellPupilSheet moved={null} pupilName="Sam Lee" onDone={onDone} />);
    expect(screen.queryByTestId('sheet-tell-pupil')).toBeNull();
  });

  it('sends the push for that lesson and says so', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('tell-push'));
    await waitFor(() => expect(screen.getByTestId('tell-note')).toHaveTextContent('Sam has been sent a notification.'));
    expect(mockCall).toHaveBeenCalledWith('/v2/lessons/l1/moved-push', 'POST');
    expect(screen.getByTestId('tell-done')).toHaveTextContent('Done');
  });

  it('says plainly when the pupil has no app on a phone, and points to a text', async () => {
    mockCall.mockResolvedValue({ notified: false });
    await open();
    await fireEvent.press(screen.getByTestId('tell-push'));
    expect(await screen.findByTestId('tell-note')).toHaveTextContent(/has not got the app set up on a phone yet/);
    expect(screen.getByTestId('tell-done')).toHaveTextContent('Skip');
  });

  it('shows why when the push could not be sent', async () => {
    mockCall.mockRejectedValue(new Error('offline'));
    await open();
    await fireEvent.press(screen.getByTestId('tell-push'));
    expect(await screen.findByTestId('tell-note')).toHaveTextContent('Could not send the notification: offline');
  });

  it('opens a text and WhatsApp to the pupil with the words already written', async () => {
    await open();
    const msg = moveMessage('Sam Lee', moved);
    await fireEvent.press(screen.getByTestId('tell-sms'));
    expect(mockSms).toHaveBeenCalledWith('07700900123', msg);
    await fireEvent.press(screen.getByTestId('tell-whatsapp'));
    expect(mockWa).toHaveBeenCalledWith('07700900123', msg);
  });

  it('says there is nothing to text when no number is saved', async () => {
    await open({}, null);
    expect(screen.getByTestId('tell-no-phone')).toBeTruthy();
    expect(screen.queryByTestId('tell-sms')).toBeNull();
  });

  it('does not push for a change still waiting to sync, but still offers a text', async () => {
    await open({ queued: true });
    expect(screen.getByTestId('tell-queued')).toBeTruthy();
    expect(screen.queryByTestId('tell-push')).toBeNull();
    expect(screen.getByTestId('tell-sms')).toBeTruthy();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('can be skipped, which sends nothing', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('tell-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockCall).not.toHaveBeenCalled();
    expect(mockSms).not.toHaveBeenCalled();
  });
});
