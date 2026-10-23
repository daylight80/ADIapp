// Sign in with an emailed link, no password. Works only for an existing account (shouldCreateUser is off), so it
// can't be used to make stray accounts. On the web the link returns to the site and supabase-js signs in from it; on a
// phone it opens the app at adipro://auth-callback (app/auth-callback.tsx). Needs the return address allowed in
// Supabase: Authentication > URL configuration.
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';
import { rateLimitSeconds } from './signupEmail';

export const MAGIC_LINK_SENT =
  "We've emailed you a sign-in link. Open it on this device. It can take a few minutes, so check your Spam or Junk folder too.";

export function magicLinkRedirect(): string {
  if (Platform.OS === 'web') return typeof window !== 'undefined' && window.location?.origin ? `${window.location.origin}/` : '/';
  return 'adipro://auth-callback';
}

/** Plain wording for a failed request for a sign-in link. */
export function friendlyMagicError(message?: string | null): string {
  const wait = rateLimitSeconds(message);
  if (wait != null) return `We've just sent you a link. Please wait ${wait} seconds before asking for another, and check your Spam or Junk folder.`;
  if (/signups? not allowed|not allowed for otp/i.test(message || '')) {
    return "We can't find an account for that email. Use the invite email from your instructor, or register first.";
  }
  if (/rate limit/i.test(message || '')) return "We've sent a lot of emails just now. Please wait a few minutes and try again.";
  return message || 'Could not send the link. Please try again.';
}

export async function sendMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  const to = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: 'Enter your email address above first.' };
  try {
    const { error } = await supabase.auth.signInWithOtp({ email: to, options: { shouldCreateUser: false, emailRedirectTo: magicLinkRedirect() } });
    return error ? { ok: false, error: friendlyMagicError(error.message) } : { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyMagicError(e?.message) };
  }
}
