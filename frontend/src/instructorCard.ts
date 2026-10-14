// What the pupil's Instructor tab shows and does, kept apart from the screen so it can be
// tested. The data comes from my_instructor_card() (migration 060).

export type InstructorCardData = {
  instructor_name?: string | null;
  adi_number?: string | null;
  business_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  /** The driving school's own phone and email, only when they differ from the instructor's. */
  school_phone?: string | null;
  school_email?: string | null;
  /** null when the school has chosen not to share the car. */
  vehicle?: {
    make_and_model?: string | null;
    registration_plate?: string | null;
    transmission?: string | null;
    colour?: string | null;
  } | null;
};

export const MAX_VEHICLE_COLOUR_LENGTH = 40;

/** What's typed as a vehicle's colour, tidied for saving: single spaces, first letter capital, null when empty. */
export function cleanVehicleColour(input: string | null | undefined): string | null {
  const t = (input || '').replace(/\s+/g, ' ').trim().slice(0, MAX_VEHICLE_COLOUR_LENGTH);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

/** "Silver VW Golf": the colour in front of the make and model, when there is one. */
export function describeCarName(v: { make_and_model?: string | null; colour?: string | null } | null | undefined): string {
  if (!v) return '';
  return [v.colour, v.make_and_model].map((p) => (p || '').trim()).filter(Boolean).join(' ');
}

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

/** "Silver VW Golf, AD39 ADI, Automatic": only the parts that are filled in. */
export function describeVehicle(v: InstructorCardData['vehicle']): string | null {
  if (!v) return null;
  const parts = [describeCarName(v), v.registration_plate, v.transmission].map((p) => (p || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
