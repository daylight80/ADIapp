import { Platform } from 'react-native';

const mockOAuth = jest.fn();
const mockLink = jest.fn();
const mockExchange = jest.fn();
const mockSetSession = jest.fn();
const mockIdentities = jest.fn();
jest.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...a: unknown[]) => mockOAuth(...a),
      linkIdentity: (...a: unknown[]) => mockLink(...a),
      exchangeCodeForSession: (...a: unknown[]) => mockExchange(...a),
      setSession: (...a: unknown[]) => mockSetSession(...a),
      getUserIdentities: (...a: unknown[]) => mockIdentities(...a),
    },
  },
}));
const mockOpen = jest.fn();
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: (...a: unknown[]) => mockOpen(...a) }));
jest.mock('expo-linking', () => ({ createURL: (p: string) => `adipro://${p}` }));

import {
  enabledProviders, providerLabel, parseAuthReturn, isUnlinkedSocialLogin, startSocial, linkedProviders, authRedirectUrl, NOT_LINKED_MESSAGE,
} from '../socialAuth';

describe('which providers are switched on', () => {
  it('reads the setting, keeps only Google and Apple, and is empty when unset', () => {
    expect(enabledProviders('google,apple')).toEqual(['google', 'apple']);
    expect(enabledProviders(' Apple , facebook, GOOGLE ')).toEqual(['google', 'apple']);
    expect(enabledProviders('apple')).toEqual(['apple']);
    expect(enabledProviders('facebook')).toEqual([]);
    expect(enabledProviders('')).toEqual([]);
    expect(enabledProviders(undefined)).toEqual([]);
    expect(providerLabel('google')).toBe('Google');
    expect(providerLabel('apple')).toBe('Apple');
  });
});

describe('what comes back from the provider', () => {
  it('reads tokens after the #, a code in the query, and errors from either', () => {
    expect(parseAuthReturn('adipro://auth-callback#access_token=a1&refresh_token=r1&expires_in=3600')).toEqual({ accessToken: 'a1', refreshToken: 'r1' });
    expect(parseAuthReturn('adipro://auth-callback?code=abc123')).toEqual({ code: 'abc123' });
    expect(parseAuthReturn('adipro://auth-callback?error=access_denied&error_description=User+cancelled')).toMatchObject({ error: 'User cancelled' });
    expect(parseAuthReturn('https://x.test/#error=server_error&error_description=Bad')).toMatchObject({ error: 'Bad' });
    expect(parseAuthReturn('adipro://auth-callback')).toEqual({});
  });
});

describe('the unlinked-account guard', () => {
  const session = (provider: string, identities: string[]) => ({ user: { app_metadata: { provider }, identities: identities.map((p) => ({ provider: p })) } });
  it('flags a Google or Apple login that is neither a pupil nor an instructor', () => {
    expect(isUnlinkedSocialLogin(session('google', ['google']), {})).toBe(true);
    expect(isUnlinkedSocialLogin(session('apple', ['apple']), { instructor_id: null, student_id: null })).toBe(true);
  });
  it('lets through a pupil or instructor, and any login that has an email identity', () => {
    expect(isUnlinkedSocialLogin(session('google', ['google']), { student_id: 's1' })).toBe(false);
    expect(isUnlinkedSocialLogin(session('apple', ['apple']), { instructor_id: 'i1' })).toBe(false);
    expect(isUnlinkedSocialLogin(session('google', ['email', 'google']), {})).toBe(false);
    expect(isUnlinkedSocialLogin(session('email', ['email']), {})).toBe(false);
  });
  it('says what to do', () => {
    expect(NOT_LINKED_MESSAGE).toMatch(/invite email/);
  });
});

describe('starting sign-in', () => {
  const originalOS = Platform.OS;
  beforeEach(() => {
    [mockOAuth, mockLink, mockExchange, mockSetSession, mockOpen, mockIdentities].forEach((m) => m.mockReset());
    (Platform as any).OS = 'android';
  });
  afterEach(() => { (Platform as any).OS = originalOS; });

  it('on a phone, opens the provider in a browser sheet and signs in with the tokens that come back', async () => {
    mockOAuth.mockResolvedValue({ data: { url: 'https://provider.test/auth' }, error: null });
    mockOpen.mockResolvedValue({ type: 'success', url: 'adipro://auth-callback#access_token=a1&refresh_token=r1' });
    mockSetSession.mockResolvedValue({ error: null });
    await expect(startSocial('signin', 'google')).resolves.toEqual({ ok: true });
    expect(mockOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'adipro://auth-callback', skipBrowserRedirect: true } });
    expect(mockOpen).toHaveBeenCalledWith('https://provider.test/auth', 'adipro://auth-callback');
    expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'a1', refresh_token: 'r1' });
  });

  it('exchanges a code when that is what comes back', async () => {
    mockOAuth.mockResolvedValue({ data: { url: 'u' }, error: null });
    mockOpen.mockResolvedValue({ type: 'success', url: 'adipro://auth-callback?code=zzz' });
    mockExchange.mockResolvedValue({ error: null });
    await expect(startSocial('signin', 'apple')).resolves.toEqual({ ok: true });
    expect(mockExchange).toHaveBeenCalledWith('zzz');
  });

  it('linking uses the identity-linking call, not a fresh sign-in', async () => {
    mockLink.mockResolvedValue({ data: { url: 'u' }, error: null });
    mockOpen.mockResolvedValue({ type: 'success', url: 'adipro://auth-callback#access_token=a&refresh_token=r' });
    mockSetSession.mockResolvedValue({ error: null });
    await startSocial('link', 'google');
    expect(mockLink).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'adipro://auth-callback', skipBrowserRedirect: true } });
    expect(mockOAuth).not.toHaveBeenCalled();
  });

  it('treats closing the browser as a cancel, not an error', async () => {
    mockOAuth.mockResolvedValue({ data: { url: 'u' }, error: null });
    mockOpen.mockResolvedValue({ type: 'cancel' });
    await expect(startSocial('signin', 'google')).resolves.toEqual({ ok: false, cancelled: true });
  });

  it('explains common failures in plain words', async () => {
    mockOAuth.mockResolvedValue({ data: null, error: { message: 'Unsupported provider: provider is not enabled' } });
    expect((await startSocial('signin', 'google')).error).toMatch(/isn't switched on/);
    mockLink.mockResolvedValue({ data: null, error: { message: 'Identity is already linked to another user' } });
    expect((await startSocial('link', 'google')).error).toMatch(/already linked/);
    mockLink.mockResolvedValue({ data: null, error: { message: 'Manual linking is disabled' } });
    expect((await startSocial('link', 'apple')).error).toMatch(/Linking accounts isn't switched on/);
    mockOAuth.mockResolvedValue({ data: { url: 'u' }, error: null });
    mockOpen.mockResolvedValue({ type: 'success', url: 'adipro://auth-callback?error=access_denied&error_description=Nope' });
    expect((await startSocial('signin', 'google')).error).toMatch(/Nope/);
    mockOpen.mockRejectedValue(new Error('boom'));
    expect((await startSocial('signin', 'google')).ok).toBe(false);
  });

  it('on the web, hands the page to the provider and comes back signed in', async () => {
    (Platform as any).OS = 'web';
    mockOAuth.mockResolvedValue({ data: {}, error: null });
    await expect(startSocial('signin', 'google')).resolves.toEqual({ ok: true, pending: true });
    expect(mockOAuth.mock.calls[0][0].options.skipBrowserRedirect).toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
    expect(authRedirectUrl()).toMatch(/\/$/);
  });
});

describe('linked providers', () => {
  it('lists them, and is empty on a failure', async () => {
    mockIdentities.mockResolvedValue({ data: { identities: [{ provider: 'email' }, { provider: 'google' }] } });
    await expect(linkedProviders()).resolves.toEqual(['email', 'google']);
    mockIdentities.mockRejectedValue(new Error('boom'));
    await expect(linkedProviders()).resolves.toEqual([]);
  });
});
