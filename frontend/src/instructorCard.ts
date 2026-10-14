// What the pupil's Instructor tab shows and does, kept apart from the screen so it can be
// tested. The data comes from my_instructor_card() (migration 060).

export type InstructorCardData = {
  instructor_name?: string | null;
  adi_number?: string | null;
  business_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  /** null when the school has chosen not to share the car. */
  vehicle?: {
    make_and_model?: string | null;
    registration_plate?: string | null;
    transmission?: string | null;
  } | null;
};

const firstName = (full: string | null | undefined) => (full || '').trim().split(/\s+/)[0] || '';

/** The text the "I'm running late" button opens, ready to send. */
export function runningLateMessage(pupilName: string | null | undefined, instructorName: string | null | undefined): string {
  const to = firstName(instructorName);
  const me = firstName(pupilName);
  return `Hi${to ? ` ${to}` : ''}, ${me ? `it's ${me}. ` : ''}I'm running a few minutes late for my lesson. Sorry!`;
}

/** An sms: link. iOS separates the body with "&", Android and the rest with "?". */
export function smsUrl(phone: string, body: string, os: string): string {
  const sep = os === 'ios' ? '&' : '?';
  return `sms:${phone.replace(/\s+/g, '')}${sep}body=${encodeURIComponent(body)}`;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/\s+/g, '')}`;
}

/** "VW Golf, AD39 ADI, Automatic": only the parts that are filled in. */
export function describeVehicle(v: InstructorCardData['vehicle']): string | null {
  if (!v) return null;
  const parts = [v.make_and_model, v.registration_plate, v.transmission].map((p) => (p || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
