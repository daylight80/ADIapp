import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

const mockForgot = jest.fn();
jest.mock('../AuthContext', () => ({ useAuth: () => ({ forgotPassword: (...a: unknown[]) => mockForgot(...a) }) }));

import ForgotPasswordScreen from '../../app/forgot-password-screen';
import { resendLabel, resendResultMessage, RESEND_WAIT_SECONDS } from '../resetResend';

describe('wording', () => {
  it('counts down, then says it can be sent again', () => {
    expect(RESEND_WAIT_SECONDS).toBe(60);
    expect(resendLabel(42)).toBe('Send it again in 42s');
    expect(resendLabel(41.2)).toBe('Send it again in 42s');
    expect(resendLabel(0)).toBe('Send it again');
    expect(resendLabel(-3)).toBe('Send it again');
  });

  it('says how the second request went', () => {
    expect(resendResultMessage(true)).toEqual({ ok: true, text: 'Sent again. It can take a few minutes to arrive.' });
    expect(resendResultMessage(false, 'Email rate limit exceeded')).toEqual({ ok: false, text: 'Email rate limit exceeded' });
    expect(resendResultMessage(false).text).toMatch(/try again in a moment/);
  });
});

describe('Check your inbox screen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockForgot.mockReset().mockResolvedValue({ ok: true });
  });
  afterEach(() => { jest.useRealTimers(); });

  const sendFirst = async () => {
    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('input-email'), 'grant@example.co.uk');
    await fireEvent.press(screen.getByTestId('btn-send-reset'));
    await waitFor(() => expect(screen.getByTestId('btn-send-again')).toBeTruthy());
  };

  it('says it can take a few minutes, and offers to send it again after a wait', async () => {
    await sendFirst();
    expect(screen.getByTestId('reset-wait-note')).toHaveTextContent(/can take a few minutes/);
    expect(screen.getByText('Send it again in 60s')).toBeTruthy();
    expect(screen.getByTestId('btn-send-again').props.accessibilityState?.disabled ?? screen.getByTestId('btn-send-again').props.disabled).toBeTruthy();

    // Pressing too early does nothing.
    await fireEvent.press(screen.getByTestId('btn-send-again'));
    expect(mockForgot).toHaveBeenCalledTimes(1);
  });

  it('counts down and then sends a second email, and starts the wait again', async () => {
    await sendFirst();
    for (let i = 0; i < 60; i += 1) { await act(async () => { jest.advanceTimersByTime(1000); }); }
    await waitFor(() => expect(screen.getByText('Send it again')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('btn-send-again'));
    await waitFor(() => expect(mockForgot).toHaveBeenCalledTimes(2));
    expect(mockForgot).toHaveBeenLastCalledWith('grant@example.co.uk');
    await waitFor(() => expect(screen.getByTestId('reset-resend-note')).toHaveTextContent(/Sent again/));
    expect(screen.getByText('Send it again in 60s')).toBeTruthy();
  });

  it('shows the reason when the second request fails, and does not restart the wait', async () => {
    await sendFirst();
    mockForgot.mockResolvedValueOnce({ ok: false, error: 'Email rate limit exceeded' });
    for (let i = 0; i < 60; i += 1) { await act(async () => { jest.advanceTimersByTime(1000); }); }
    await fireEvent.press(screen.getByTestId('btn-send-again'));
    await waitFor(() => expect(screen.getByTestId('reset-resend-note')).toHaveTextContent(/Email rate limit exceeded/));
    expect(screen.getByText('Send it again')).toBeTruthy();
  });
});
