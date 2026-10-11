// The Pupil Agreement is signed by the student (Migration 051). These helpers read
// the record for both sides: the student's own dashboard and the instructor's view
// of that student's profile.

export type AgreementRecord = {
  tc_signed_at?: string | null;
  tc_signature_name?: string | null;
};

export type AgreementStatus = { signed: boolean; signedBy: string | null; signedAt: string | null };

export function agreementStatus(student: AgreementRecord | null | undefined): AgreementStatus {
  const at = student?.tc_signed_at || null;
  return { signed: !!at, signedBy: at ? (student?.tc_signature_name || null) : null, signedAt: at };
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** What the instructor reads on a student's profile. */
export function instructorAgreementLine(student: AgreementRecord | null | undefined, firstName: string): string {
  const s = agreementStatus(student);
  if (!s.signed || !s.signedAt) return `${firstName} hasn't signed the Pupil Agreement yet.`;
  const by = s.signedBy ? ` by ${s.signedBy}` : '';
  return `Agreed${by} on ${formatDate(s.signedAt)}.`;
}

/** The student's own link text. */
export function studentAgreementLabel(student: AgreementRecord | null | undefined): string {
  return agreementStatus(student).signed ? 'Pupil Agreement (signed ✓)' : 'Pupil Agreement — sign now';
}

const UNLINKED_MESSAGE =
  "Your account isn't linked to your instructor yet. Ask your instructor to re-send your invite email, then open the link in that email.";

/**
 * What to tell a pupil when signing fails. The database refuses (code P0002) when the
 * login is not linked to a pupil record, which happens if they signed up from the
 * back-up link instead of the invite email. Anything else keeps its own message.
 */
export function agreementSignError(error: { code?: string; message?: string } | null | undefined): string {
  if (error?.code === 'P0002' || /no student record is linked/i.test(error?.message || '')) return UNLINKED_MESSAGE;
  if (error?.code === '28000' || /not signed in/i.test(error?.message || '')) return 'Please sign in again, then try signing the agreement.';
  return error?.message || 'Please try again.';
}
