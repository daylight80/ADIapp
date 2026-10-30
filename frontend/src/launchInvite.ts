/**
 * The ?invite= token of the page address the app was opened with (web only).
 * The router does not hand it to the root layout in time: the first redirect (to the diary,
 * or to the sign-in page) ran first and dropped it, so an invite link never showed its invite.
 */
export function inviteFromSearch(search: string): string {
  return new URLSearchParams(search).get('invite') || '';
}
