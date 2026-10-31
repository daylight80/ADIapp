/**
 * The ?invite= token of the page address the app was opened with (web only).
 * The router does not hand it to the root layout in time: the first redirect (to the diary,
 * or to the sign-in page) ran first and dropped it, so an invite link never showed its invite.
 */
export function inviteFromSearch(search: string): string {
  return new URLSearchParams(search).get('invite') || '';
}

/**
 * What kind of emailed sign-in link the page was opened from: 'recovery' (forgotten password) or 'invite',
 * read from the #...&type=... part of the address. Supabase signs the person in and then removes that part,
 * so it is captured once, when this file loads, which must be before the Supabase client does (see _layout).
 */
export function authKindFromHash(hash: string): 'recovery' | 'invite' | '' {
  const t = new URLSearchParams(hash.replace(/^#/, '')).get('type');
  return t === 'recovery' || t === 'invite' ? t : '';
}

export const LAUNCH_AUTH_KIND: 'recovery' | 'invite' | '' =
  typeof window !== 'undefined' && window.location && typeof window.location.hash === 'string' ? authKindFromHash(window.location.hash) : '';
