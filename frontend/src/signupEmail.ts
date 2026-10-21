// Registration sends a confirmation email, and that email can be slow or land in Spam. People then press Register
// again and meet the server's one-email-a-minute limit, which used to show as raw text ("For security purposes,
// you can only request this after 53 seconds"). These helpers turn that into plain wording.

/** Seconds named in a "you can only request this after N seconds" message, or null if it isn't one. */
export function rateLimitSeconds(message?: string | null): number | null {
  const m = /only request this after (\d+) seconds?/i.exec(message || '');
  return m ? Number(m[1]) : null;
}

/** Wording for an error from sign-up or from asking for the confirmation email again. */
export function friendlyEmailError(message?: string | null): string {
  const wait = rateLimitSeconds(message);
  if (wait != null) {
    return `We've already sent your confirmation email. Please wait ${wait} seconds before asking for another, and check your Spam or Junk folder.`;
  }
  if (/rate limit/i.test(message || '')) {
    return "We've sent a lot of emails just now. Please wait a few minutes and try again, and check your Spam or Junk folder for the one we already sent.";
  }
  return message || 'Registration failed';
}

/** Shown after registering, until the email has been confirmed. */
export const CONFIRM_EMAIL_NOTE =
  "It can take a few minutes to arrive. If you can't see it, check your Spam or Junk folder and mark it as 'Not spam' so later emails arrive normally.";
