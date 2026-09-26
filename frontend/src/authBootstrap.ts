// Decides whether a signed-in auth user is a self-registered instructor who
// still needs their school + instructor rows created, and with what details.
//
// Why this exists (26 Sept 2026): signUp() used to create those rows only when
// Supabase returned a session straight away. With "Confirm email" switched ON
// there is no session until the emailed link is clicked, so that step was skipped
// and the instructor would confirm, sign in, and have a login with no school and
// no instructor record (and their ADI number and referral code lost). Everything
// needed is saved on the auth user's metadata at sign-up, so loadProfile() can
// finish the job on first sign-in using this.
//
// Pure (no network) so it can be unit tested.

export type InstructorBootstrapArgs = {
  authUserId: string;
  email: string;
  name: string;
  adi_number: string;
  referralCode?: string;
};

type AuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, any> | null;
};

export function instructorBootstrapArgsFromAuthUser(authUser: AuthUserLike): InstructorBootstrapArgs | null {
  const meta = authUser.user_metadata || {};

  // Only self-registered instructors. Students (role 'student') and instructors
  // added by a school owner (no adi_number in metadata; their row already exists
  // and is matched by email) are never bootstrapped here.
  if (meta.role !== 'instructor') return null;

  const adi =
    typeof meta.adi_number === 'string' ? meta.adi_number.trim()
      : typeof meta.adi_number === 'number' ? String(meta.adi_number)
      : '';
  if (!adi) return null;

  const email = authUser.email || '';
  const name = String(meta.name || meta.full_name || email.split('@')[0] || '').trim();
  if (!name) return null;

  const referral = typeof meta.referral_code === 'string' ? meta.referral_code.trim().toUpperCase() : '';

  return {
    authUserId: authUser.id,
    email,
    name,
    adi_number: adi,
    ...(referral ? { referralCode: referral } : {}),
  };
}
