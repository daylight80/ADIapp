// Sign in with Google or Apple, for pupils who were invited by an instructor.
//
// The safe route is: the pupil clicks their invite (which signs them in as the invited user), then links Google or
// Apple to that same account from the app. That works even when the Google or Apple email differs from the invited one
// (Apple's "Hide my email" gives a made-up address). After that, "Continue with Google/Apple" on the sign-in screen
// signs in to that same account. A Google or Apple account that is not linked to any pupil or instructor is signed
// straight out again with a clear message, so a stray account never lands in the app.
//
// The buttons appear only for the providers listed in EXPO_PUBLIC_SOCIAL_PROVIDERS ("google,apple"), which stays empty
// until the provider has been set up in Supabase, so nothing shows that would not work.
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from './supabaseClient';

export type SocialProvider = 'google' | 'apple';
const KNOWN: SocialProvider[] = ['google', 'apple'];

export const NOT_LINKED_MESSAGE =
  "That Google or Apple account isn't linked to DualControl yet. Open the invite email from your instructor first, then choose \"Continue with Google\" or \"Continue with Apple\" from inside the app. Or sign in with your email and password.";

/** The providers switched on, from a setting like "google,apple". Unknown names are ignored. */
export function enabledProviders(raw: string | undefined = process.env.EXPO_PUBLIC_SOCIAL_PROVIDERS): SocialProvider[] {
  const wanted = (raw || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  return KNOWN.filter((p) => wanted.includes(p));
}

export function providerLabel(p: SocialProvider): string {
  return p === 'google' ? 'Google' : 'Apple';
}

/** Where the provider sends the pupil back to: this site on the web, the app's own address on a phone. */
export function authRedirectUrl(): string {
  if (Platform.OS === 'web') return typeof window !== 'undefined' && window.location?.origin ? `${window.location.origin}/` : '/';
  return Linking.createURL('auth-callback');
}

export type AuthReturn = { code?: string; accessToken?: string; refreshToken?: string; error?: string };

/** What came back in the redirect address: a code, or tokens, or an error (in the query or after the #). */
export function parseAuthReturn(url: string): AuthReturn {
  const out: AuthReturn = {};
  const parts = [url.split('#')[1] || '', (url.split('?')[1] || '').split('#')[0]];
  for (const part of parts) {
    const p = new URLSearchParams(part);
    out.code = out.code || p.get('code') || undefined;
    out.accessToken = out.accessToken || p.get('access_token') || undefined;
    out.refreshToken = out.refreshToken || p.get('refresh_token') || undefined;
    out.error = out.error || p.get('error_description') || p.get('error') || undefined;
  }
  return out;
}

/** True for a login made through Google or Apple only (no email login) that matches no pupil and no instructor. */
export function isUnlinkedSocialLogin(
  session: { user: { app_metadata?: any; identities?: { provider: string }[] | null } },
  profile: { instructor_id?: string | null; student_id?: string | null },
): boolean {
  const provider = session.user.app_metadata?.provider;
  const social = provider === 'google' || provider === 'apple';
  const hasEmailLogin = (session.user.identities || []).some((i) => i.provider === 'email');
  return social && !hasEmailLogin && !profile.instructor_id && !profile.student_id;
}

export type SocialResult = { ok: boolean; error?: string; cancelled?: boolean; pending?: boolean };

function friendlyError(raw: string | undefined): string {
  const m = raw || '';
  if (/identity.*already|already.*linked|already exists/i.test(m)) return 'That account is already linked to another DualControl login.';
  if (/manual linking/i.test(m)) return "Linking accounts isn't switched on yet. Please tell your instructor.";
  if (/provider.*not enabled|unsupported provider/i.test(m)) return "That sign-in option isn't switched on yet.";
  return m ? `Couldn't sign in that way: ${m}` : "Couldn't sign in that way. Please try again.";
}

/**
 * Start Google or Apple sign-in ('signin') or link it to the account already signed in ('link'). On the web the page
 * goes to the provider and comes back signed in, so the result is "pending". On a phone a browser sheet opens and the
 * result is known when it closes.
 */
export async function startSocial(mode: 'signin' | 'link', provider: SocialProvider): Promise<SocialResult> {
  const redirectTo = authRedirectUrl();
  const web = Platform.OS === 'web';
  try {
    const opts = { redirectTo, skipBrowserRedirect: !web };
    const { data, error } = mode === 'link'
      ? await supabase.auth.linkIdentity({ provider, options: opts })
      : await supabase.auth.signInWithOAuth({ provider, options: opts });
    if (error) return { ok: false, error: friendlyError(error.message) };
    if (web) return { ok: true, pending: true };
    if (!data?.url) return { ok: false, error: friendlyError(undefined) };

    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== 'success' || !('url' in res) || !res.url) return { ok: false, cancelled: true };
    return await completeAuthReturn(res.url);
  } catch (e: any) {
    return { ok: false, error: friendlyError(e?.message) };
  }
}

/** Turn the address the sign-in came back to (a social login or an emailed sign-in link) into a signed-in session. */
export async function completeAuthReturn(url: string): Promise<SocialResult> {
  try {
    const back = parseAuthReturn(url);
    if (back.error) return { ok: false, error: friendlyError(back.error) };
    if (back.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(back.code);
      return error ? { ok: false, error: friendlyError(error.message) } : { ok: true };
    }
    if (back.accessToken && back.refreshToken) {
      const { error } = await supabase.auth.setSession({ access_token: back.accessToken, refresh_token: back.refreshToken });
      return error ? { ok: false, error: friendlyError(error.message) } : { ok: true };
    }
    return { ok: false, error: friendlyError(undefined) };
  } catch (e: any) {
    return { ok: false, error: friendlyError(e?.message) };
  }
}

/** The providers linked to the signed-in account ('email', 'google', 'apple'). */
export async function linkedProviders(): Promise<string[]> {
  try {
    const { data } = await supabase.auth.getUserIdentities();
    return (data?.identities || []).map((i: any) => String(i.provider));
  } catch {
    return [];
  }
}
