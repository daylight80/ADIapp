// The password rules, kept the same on the sign-up, invite and reset screens, and matching what Supabase is set to
// enforce on the server (minimum 8 characters, letters and digits). Checking here first gives a clear message
// before anything is sent. Kept apart from the screens so it can be tested.

export const MIN_PASSWORD_LENGTH = 8;

/** The hint shown under a "choose a password" box. */
export const PASSWORD_HINT = 'At least 8 characters, with letters and numbers';

/** What is wrong with a new password, in words for the person choosing it; null when it is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers in your password.';
  return null;
}
