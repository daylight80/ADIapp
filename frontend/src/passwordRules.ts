// The password rules, kept the same on the sign-up, invite and reset screens: at least 10 characters with letters and
// numbers, nothing from a short list of passwords everyone tries first, and nothing built from the person's own name
// or email. Checking here gives a clear message before anything is sent, but it is a convenience only: the real
// enforcement is Supabase Auth's own password settings (Dashboard > Authentication), which should be set to match.
// Kept apart from the screens so it can be tested.

export const MIN_PASSWORD_LENGTH = 10;

/** The hint shown under a "choose a password" box. */
export const PASSWORD_HINT = 'At least 10 characters, with letters and numbers. Avoid common words and your name.';

// Words that make a password easy to guess when they are all there is apart from digits or a trailing symbol
// ("Password123!", "Liverpool2026", "Qwerty12345"). Compared after lower-casing, swapping common look-alike
// characters (p@ssw0rd) and stripping trailing digits and symbols. shortcut: a short list, not a breach database;
// Supabase's leaked-password check (Pro plan) is the thorough version.
const COMMON_BASES = new Set([
  'password', 'passwort', 'qwerty', 'qwertyuiop', 'qwertyui', 'azerty', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm',
  'welcome', 'letmein', 'admin', 'administrator', 'iloveyou', 'trustno', 'login', 'master', 'secret', 'changeme',
  'default', 'test', 'testing', 'hello', 'freedom', 'whatever', 'shadow', 'sunshine', 'princess', 'superman',
  'batman', 'dragon', 'monkey', 'football', 'baseball', 'basketball', 'liverpool', 'arsenal', 'chelsea', 'manutd',
  'manchester', 'tottenham', 'london', 'england', 'britain', 'summer', 'winter', 'spring', 'autumn', 'holiday',
  'computer', 'internet', 'starwars', 'pokemon', 'charlie', 'michael', 'jennifer', 'jessica', 'daniel', 'thomas',
  'driving', 'driver', 'instructor', 'learner', 'student', 'teacher', 'lessons', 'lesson', 'theory', 'practical',
  'dualcontrol', 'dcpro', 'adipro', 'abcdef', 'abcdefgh', 'abcdefghij', 'iloveu', 'monday', 'friday', 'sunday',
]);

const LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function baseOf(password: string): string {
  const stripped = password.toLowerCase().replace(/[0-9!@#$%^&*()._\-+=?]+$/, '');
  return stripped.replace(/[0-9@$!]/g, (c) => LOOKALIKES[c] ?? c);
}

/** One character repeated, or a straight run like abcdefghij1 / 1234567890a, is as bad as a common word. */
function isRepetitiveOrSequential(password: string): boolean {
  const p = password.toLowerCase();
  if (new Set(p).size <= 2) return true;
  const runs = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return p.length >= 8 && (runs.includes(p.slice(0, 8)) || runs.split('').reverse().join('').includes(p.slice(0, 8)));
}

export type PasswordContext = { email?: string | null; name?: string | null };

/** Parts of the person's own details that must not appear in the password: the email's name part and each name word. */
function personalParts(ctx: PasswordContext): string[] {
  const parts: string[] = [];
  const local = (ctx.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (local.length >= 4) parts.push(local);
  for (const w of (ctx.name || '').toLowerCase().split(/[^a-z]+/)) if (w.length >= 4) parts.push(w);
  return parts;
}

/** What is wrong with a new password, in words for the person choosing it; null when it is acceptable. */
export function passwordProblem(password: string, ctx: PasswordContext = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers in your password.';
  const lower = password.toLowerCase();
  if (personalParts(ctx).some((part) => lower.includes(part))) return 'Your password should not contain your name or email address.';
  if (COMMON_BASES.has(baseOf(password)) || isRepetitiveOrSequential(password)) {
    return 'That password is too easy to guess. Choose something less common.';
  }
  return null;
}
