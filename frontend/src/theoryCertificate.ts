// The theory test pass certificate number: kept on the pupil's passed theory test, and needed to book the
// practical test. The DVSA has a free lookup for a pupil who has lost theirs. Kept apart from the screen so it can
// be tested.

export const THEORY_LOOKUP_URL = 'https://www.gov.uk/find-theory-test-pass-number';
export const MAX_CERTIFICATE_CHARS = 20;

/** What is typed into the box: letters and numbers only, upper case, no spaces, capped in length. */
export function cleanCertificateInput(raw: string): string {
  return (raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, MAX_CERTIFICATE_CHARS);
}

/** What is saved: the cleaned number, or null when empty. */
export function certificateToSave(raw: string | null | undefined): string | null {
  const c = cleanCertificateInput(raw || '');
  return c || null;
}

/** A number as read aloud or copied: groups of four ("1234 5678"). Short ones stay as they are. */
export function certificateDisplay(value: string | null | undefined): string {
  const c = cleanCertificateInput(value || '');
  return c.length > 4 ? (c.match(/.{1,4}/g) as string[]).join(' ') : c;
}

/** The certificate number only belongs on a passed theory test. */
export function certificateApplies(testType: string, result: string): boolean {
  return testType === 'theory' && result === 'pass';
}
