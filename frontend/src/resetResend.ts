// The "Send it again" button on the Check your inbox screen. A reset email can be slow to arrive, so there is a
// button to send another, with a short wait first so it is not pressed repeatedly (the server only allows one
// reset email per address a minute anyway).
export const RESEND_WAIT_SECONDS = 60;

/** "Send it again" once the wait is over, otherwise "Send it again in 42s". */
export function resendLabel(secondsLeft: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft));
  return s > 0 ? `Send it again in ${s}s` : 'Send it again';
}

/** What to say after a second email was requested. */
export function resendResultMessage(ok: boolean, error?: string): { ok: boolean; text: string } {
  return ok
    ? { ok: true, text: 'Sent again. It can take a few minutes to arrive.' }
    : { ok: false, text: error || "Couldn't send it again. Please try again in a moment." };
}
