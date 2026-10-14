// What a pupil can edit about themselves, and the rules for it. The same rules are enforced
// by the database function update_my_student_details (migration 059); checking here first
// gives the pupil a clear message before anything is sent. Kept apart from the screen so it
// can be tested.

export type PupilDetailsInput = { phone: string; address: string; postcode: string; licence: string };

export type PupilDetailsResult =
  | { ok: true; values: PupilDetailsInput }
  | { ok: false; error: string };

/** A UK provisional licence number is 16 letters and numbers; spaces are ignored. */
export function normaliseLicence(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function validatePupilDetails(input: PupilDetailsInput): PupilDetailsResult {
  const phone = input.phone.trim();
  if (!/^[0-9+() -]{6,20}$/.test(phone)) return { ok: false, error: 'Enter a valid mobile number.' };

  const address = input.address.trim();
  if (address.length > 200) return { ok: false, error: 'The address is too long (200 characters at most).' };

  const postcode = input.postcode.trim().toUpperCase();
  if (postcode.length > 10) return { ok: false, error: 'The postcode is too long.' };

  const licence = normaliseLicence(input.licence);
  if (!/^[A-Z0-9]{16}$/.test(licence)) {
    return { ok: false, error: 'Your provisional licence number must be 16 letters and numbers.' };
  }
  return { ok: true, values: { phone, address, postcode, licence } };
}
