import { agreementSignError, agreementStatus, instructorAgreementLine, studentAgreementLabel } from '../pupilAgreement';

import { mediaConsentLine } from '../pupilAgreement';

describe('mediaConsentLine', () => {
  it('says No when nothing has been chosen', () => {
    expect(mediaConsentLine({})).toBe('Photo/video consent: No');
    expect(mediaConsentLine(null)).toBe('Photo/video consent: No');
  });
  it('says Yes, with the date, when the pupil agreed', () => {
    expect(mediaConsentLine({ media_consent: true, media_consent_at: '2026-10-14T13:00:00.000Z' }))
      .toBe('Photo/video consent: Yes (updated 14-10-2026)');
  });
  it('says No, with the date, after the pupil withdrew', () => {
    expect(mediaConsentLine({ media_consent: false, media_consent_at: '2026-10-14T13:00:00.000Z' }))
      .toBe('Photo/video consent: No (updated 14-10-2026)');
  });
});

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
    expect(instructorAgreementLine(signed, 'Callum')).toBe('Agreed by Callum Goody on 03-10-2026.');
  });

  it('still confirms when the signature name is missing', () => {
    expect(instructorAgreementLine({ tc_signed_at: signed.tc_signed_at }, 'Callum')).toBe('Agreed on 03-10-2026.');
  });
});

describe('studentAgreementLabel', () => {
  it('asks to sign, then shows signed', () => {
    expect(studentAgreementLabel({})).toBe('Pupil Agreement — sign now');
    expect(studentAgreementLabel(signed)).toBe('Pupil Agreement (signed ✓)');
  });
});

describe('agreementSignError', () => {
  it('tells an unlinked pupil to ask for a new invite email, by code or by message', () => {
    expect(agreementSignError({ code: 'P0002', message: 'whatever' })).toMatch(/re-send your invite email/);
    expect(agreementSignError({ message: 'No student record is linked to this account' })).toMatch(/re-send your invite email/);
  });

  it('asks for a fresh sign-in when the session has gone', () => {
    expect(agreementSignError({ code: '28000', message: 'Not signed in' })).toMatch(/sign in again/);
  });

  it('keeps any other error message, with a fallback when there is none', () => {
    expect(agreementSignError({ message: 'Signature must be between 3 and 120 characters' })).toBe('Signature must be between 3 and 120 characters');
    expect(agreementSignError(undefined)).toBe('Please try again.');
    expect(agreementSignError({})).toBe('Please try again.');
  });
});
