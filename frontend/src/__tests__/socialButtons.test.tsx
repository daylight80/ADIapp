import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockStart = jest.fn();
const mockLinked = jest.fn();
let mockEnabled: ('google' | 'apple')[] = [];
jest.mock('../socialAuth', () => ({
  enabledProviders: () => mockEnabled,
  providerLabel: (p: string) => (p === 'google' ? 'Google' : 'Apple'),
  startSocial: (...a: unknown[]) => mockStart(...a),
  linkedProviders: (...a: unknown[]) => mockLinked(...a),
}));

import { SocialButtons } from '../SocialButtons';
import { SignInFasterCard } from '../SignInFasterCard';

beforeEach(() => { mockStart.mockReset(); mockLinked.mockReset(); mockEnabled = []; });

describe('SocialButtons', () => {
  it('shows nothing until a provider is switched on', async () => {
    const { queryByTestId } = await render(<SocialButtons mode="signin" onError={jest.fn()} />);
    expect(queryByTestId('social-signin-google')).toBeNull();
  });

  it('shows a button per switched-on provider and starts sign-in on press', async () => {
    mockEnabled = ['google', 'apple'];
    mockStart.mockResolvedValue({ ok: true, pending: true });
    const { getByTestId, getByText } = await render(<SocialButtons mode="signin" onError={jest.fn()} />);
    expect(getByText('Continue with Apple')).toBeTruthy();
    await fireEvent.press(getByTestId('social-signin-google'));
    await waitFor(() => expect(mockStart).toHaveBeenCalledWith('signin', 'google'));
  });

  it('reports an error but not a cancel', async () => {
    mockEnabled = ['google'];
    const onError = jest.fn();
    mockStart.mockResolvedValueOnce({ ok: false, cancelled: true });
    const { getByTestId } = await render(<SocialButtons mode="signin" onError={onError} />);
    await fireEvent.press(getByTestId('social-signin-google'));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
    mockStart.mockResolvedValueOnce({ ok: false, error: 'Nope' });
    await fireEvent.press(getByTestId('social-signin-google'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Nope'));
  });
});

describe('SignInFasterCard', () => {
  it('is hidden when no provider is switched on', async () => {
    mockLinked.mockResolvedValue(['email']);
    const { queryByTestId } = await render(<SignInFasterCard />);
    expect(queryByTestId('v2-student-signin-faster')).toBeNull();
  });

  it('offers only the providers not yet linked, and says what is linked', async () => {
    mockEnabled = ['google', 'apple'];
    mockLinked.mockResolvedValue(['email', 'google']);
    const { findByTestId, queryByTestId, getByText } = await render(<SignInFasterCard />);
    await findByTestId('v2-student-signin-faster');
    expect(getByText(/Linked: Google/)).toBeTruthy();
    expect(queryByTestId('social-link-google')).toBeNull();
    expect(queryByTestId('social-link-apple')).toBeTruthy();
  });
});
