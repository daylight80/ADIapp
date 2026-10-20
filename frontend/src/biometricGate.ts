// When the fingerprint unlock applies. It exists to protect a session the phone is
// still holding (reopening the app, or coming back to it from the background). It
// should not run straight after the user has just typed their password: that already
// proves who they are, and if the fingerprint prompt then fails, is cancelled or can't
// appear (some phones block it while the screen is being recorded), the app used to
// sign them straight back out and reset the sign-in form with no message.

export function needsBiometricUnlock(enabled: boolean, freshPasswordSignIn: boolean): boolean {
  return enabled && !freshPasswordSignIn;
}

// How long an unlock stays valid. Switching to another app and back inside this window does
// not ask again; a full close of the app, or signing out, always does.
export const UNLOCK_WINDOW_MS = 4 * 60 * 60 * 1000;

/** True when the last unlock is older than the window (or there has been none), so the app should lock again. */
export function isUnlockExpired(unlockedAt: number | null, now: number, windowMs: number = UNLOCK_WINDOW_MS): boolean {
  return unlockedAt == null || now - unlockedAt >= windowMs;
}
