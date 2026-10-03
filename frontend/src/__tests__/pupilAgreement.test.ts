import { agreementStatus, instructorAgreementLine, studentAgreementLabel } from '../pupilAgreement';

const signed = { tc_signed_at: '2026-10-03T09:15:00.000Z', tc_signature_name: 'Callum Goody' };

describe('agreementStatus', () => {
  it('is unsigned when there is no student or no timestamp', () => {
    expect(agreementStatus(undefined)).toEqual({ signed: false, signedBy: null, signedAt: null });
    expect(agreementStatus({ tc_signed_at: null, tc_signature_name: 'Stale Name' }).signed).toBe(false);
  });

  it('reads who signed and when', () => {
    expect(agreementStatus(signed)).toEqual({ signed: true, signedBy: 'Callum Goody', signedAt: signed.tc_signed_at });
  });
});

describe('instructorAgreementLine', () => {
  it('tells the instructor when the student has not signed', () => {
    expect(instructorAgreementLine({}, 'Callum')).toBe("Callum hasn't signed the Pupil Agreement yet.");
  });

  it('confirms the agreement with name and date once signed', () => {
    expect(instructorAgreementLine(signed, 'Callum')).toBe('Agreed by Callum Goody on 3 October 2026.');
  });

  it('still confirms when the signature name is missing', () => {
    expect(instructorAgreementLine({ tc_signed_at: signed.tc_signed_at }, 'Callum')).toBe('Agreed on 3 October 2026.');
  });
});

describe('studentAgreementLabel', () => {
  it('asks to sign, then shows signed', () => {
    expect(studentAgreementLabel({})).toBe('Pupil Agreement — sign now');
    expect(studentAgreementLabel(signed)).toBe('Pupil Agreement (signed ✓)');
  });
});
