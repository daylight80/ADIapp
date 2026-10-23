import React from 'react';
import { Platform } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

const mockOtp = jest.fn();
jest.mock('../supabaseClient', () => ({ supabase: { auth: { signInWithOtp: (...a: unknown[]) => mockOtp(...a) } } }));
const mockComplete = jest.fn();
jest.mock('../socialAuth', () => ({ completeAuthReturn: (...a: unknown[]) => mockComplete(...a) }));
let mockUrl: string | null = null;
jest.mock('expo-linking', () => ({ useURL: () => mockUrl }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));

import { sendMagicLink, friendlyMagicError, magicLinkRedirect } from '../magicLink';
import AuthCallback from '../../app/auth-callback';

describe('sending the sign-in link', () => {
  const originalOS = Platform.OS;
  beforeEach(() => { mockOtp.mockReset(); (Platform as any).OS = 'android'; });
  afterEach(() => { (Platform as any).OS = originalOS; });

  it('asks for a link for an existing account only, returning to the app', async () => {
    mockOtp.mockResolvedValue({ error: null });
    await expect(sendMagicLink('  sam@example.co.uk ')).resolves.toEqual({ ok: true });
    expect(mockOtp).toHaveBeenCalledWith({ email: 'sam@example.co.uk', options: { shouldCreateUser: false, emailRedirectTo: 'adipro://auth-callback' } });
  });

  it('does not ask for a link without a usable email', async () => {
    const r = await sendMagicLink('not an email');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/email address/);
    expect(mockOtp).not.toHaveBeenCalled();
  });

  it('returns to the website on the web', () => {
    (Platform as any).OS = 'web';
    expect(magicLinkRedirect()).toMatch(/\/$/);
  });

  it('explains the common failures in plain words', async () => {
    expect(friendlyMagicError('For security purposes, you can only request this after 42 seconds.')).toMatch(/wait 42 seconds/);
    expect(friendlyMagicError('Signups not allowed for otp')).toMatch(/can't find an account/);
    expect(friendlyMagicError('email rate limit exceeded')).toMatch(/few minutes/);
    mockOtp.mockResolvedValue({ error: { message: 'Signups not allowed for otp' } });
    expect((await sendMagicLink('x@y.co')).error).toMatch(/can't find an account/);
    mockOtp.mockRejectedValue(new Error('Network request failed'));
    expect((await sendMagicLink('x@y.co')).error).toBe('Network request failed');
  });
});

describe('the sign-in link landing screen', () => {
  beforeEach(() => { mockComplete.mockReset(); mockReplace.mockReset(); mockUrl = null; });

  it('signs in from the link and goes home', async () => {
    mockUrl = 'adipro://auth-callback#access_token=a&refresh_token=b';
    mockComplete.mockResolvedValue({ ok: true });
    await render(<AuthCallback />);
    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith(mockUrl));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('shows what went wrong, with a way back to sign in', async () => {
    mockUrl = 'adipro://auth-callback#error_description=Link+expired';
    mockComplete.mockResolvedValue({ ok: false, error: 'Link expired' });
    await render(<AuthCallback />);
    expect(await screen.findByTestId('auth-callback-error')).toHaveTextContent('Link expired');
    await fireEvent.press(screen.getByTestId('auth-callback-back'));
    expect(mockReplace).toHaveBeenCalledWith('/sign-up-login-screen');
  });
});
