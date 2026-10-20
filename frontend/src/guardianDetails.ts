// A parent or guardian's contact details for a pupil under 18. All optional; if a phone number or email
// is given there must be a name, so the instructor knows who they are calling. Kept apart from the screen
// so it can be tested.

export type GuardianInput = { name: string; phone: string; email: string };

export type GuardianResult =
  | { ok: true; values: GuardianInput }
  | { ok: false; error: string };

export const hasGuardian = (g: { guardian_name?: string | null; guardian_phone?: string | null; guardian_email?: string | null }): boolean =>
  !!(g.guardian_name?.trim() || g.guardian_phone?.trim() || g.guardian_email?.trim());

export function validateGuardian(input: GuardianInput): GuardianResult {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();

  if (!name && !phone && !email) return { ok: true, values: { name: '', phone: '', email: '' } };

  if (!name) return { ok: false, error: 'Enter the parent or guardian’s name.' };
  if (name.length > 100) return { ok: false, error: 'The parent or guardian’s name is too long.' };
  if (phone && !/^[0-9+() -]{6,20}$/.test(phone)) return { ok: false, error: 'Enter a valid parent or guardian phone number.' };
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, error: 'Enter a valid parent or guardian email address.' };
  }
  if (!phone && !email) return { ok: false, error: 'Add a phone number or an email for the parent or guardian.' };
  return { ok: true, values: { name, phone, email } };
}

/** A phone number reduced to what a tel: link needs. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}
