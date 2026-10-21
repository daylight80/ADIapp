import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

const mockSignUp = jest.fn();
const mockResend = jest.fn();
jest.mock('../AuthContext', () => ({
  useAuth: () => ({
    signIn: jest.fn(),
    acceptInvite: jest.fn(),
    signUp: (...a: unknown[]) => mockSignUp(...a),
    resendConfirmation: (...a: unknown[]) => mockResend(...a),
  }),
}));

import SignUpLoginScreen from '../../app/sign-up-login-screen';
import { friendlyEmailError, rateLimitSeconds, CONFIRM_EMAIL_NOTE } from '../signupEmail';

describe('wording', () => {
  it('turns the one-a-minute limit into plain words with the wait in it', () => {
    const raw = 'For security purposes, you can only request this after 53 seconds.';
    expect(rateLimitSeconds(raw)).toBe(53);
    const text = friendlyEmailError(raw);
    expect(text).toMatch(/already sent your confirmation email/);
    expect(text).toMatch(/53 seconds/);
    expect(text).toMatch(/Spam/);
    expect(text).not.toMatch(/security purposes/i);
  });

  it('handles the hourly limit and passes other errors through', () => {
    expect(friendlyEmailError('email rate limit exceeded')).toMatch(/wait a few minutes/);
    expect(friendlyEmailError('User already registered')).toBe('User already registered');
    expect(friendlyEmailError('')).toBe('Registration failed');
    expect(rateLimitSeconds(undefined)).toBeNull();
  });
});

describe('Register screen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSignUp.mockReset().mockResolvedValue({ ok: true, needs_confirmation: true });
    mockResend.mockReset().mockResolvedValue({ ok: true });
  });
  afterEach(() => { jest.useRealTimers(); });

  const register = async () => {
    await render(<SignUpLoginScreen />);
    await fireEvent.press(screen.getByTestId('v2-tab-register'));
    await fireEvent.changeText(screen.getByTestId('v2-input-name'), 'Dave Fletcher');
    await fireEvent.changeText(screen.getByTestId('v2-input-email'), 'dave@example.co.uk');
    await fireEvent.changeText(screen.getByTestId('v2-input-password'), 'Passw0rdOk1');
    await fireEvent.changeText(screen.getByTestId('v2-input-adi'), '123456');
    await fireEvent.press(screen.getByTestId('v2-btn-submit'));
    await waitFor(() => expect(screen.getByTestId('v2-confirm-message')).toBeTruthy());
  };

  it('says to check email (and Spam) after registering, instead of staying silent', async () => {
    await register();
    expect(screen.getByTestId('v2-confirm-message')).toHaveTextContent(/dave@example\.co\.uk/);
    expect(screen.getByTestId('v2-confirm-spam-note')).toHaveTextContent(CONFIRM_EMAIL_NOTE);
    expect(screen.getByText('Send it again in 60s')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('v2-btn-send-again'));
    expect(mockResend).not.toHaveBeenCalled();
  });

  it('sends the confirmation again after the wait, and starts the wait again', async () => {
    await register();
    for (let i = 0; i < 60; i += 1) { await act(async () => { jest.advanceTimersByTime(1000); }); }
    await waitFor(() => expect(screen.getByText('Send it again')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('v2-btn-send-again'));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith('dave@example.co.uk'));
    await waitFor(() => expect(screen.getByTestId('v2-resend-note')).toHaveTextContent(/Sent again/));
    expect(screen.getByText('Send it again in 60s')).toBeTruthy();
  });

  it('goes back to sign in from the confirmation panel', async () => {
    await register();
    await fireEvent.press(screen.getByTestId('v2-btn-go-signin'));
    expect(screen.getByTestId('v2-tab-signin')).toBeTruthy();
    expect(screen.queryByTestId('v2-confirm-message')).toBeNull();
  });
});
