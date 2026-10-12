// When the fingerprint unlock applies. It exists to protect a session the phone is
// still holding (reopening the app, or coming back to it from the background). It
// should not run straight after the user has just typed their password: that already
// proves who they are, and if the fingerprint prompt then fails, is cancelled or can't
// appear (some phones block it while the screen is being recorded), the app used to
// sign them straight back out and reset the sign-in form with no message.

export function needsBiometricUnlock(enabled: boolean, freshPasswordSignIn: boolean): boolean {
  return enabled && !freshPasswordSignIn;
}
