import {
  THEORY_LOOKUP_URL, cleanCertificateInput, certificateToSave, certificateDisplay, certificateApplies, MAX_CERTIFICATE_CHARS,
} from '../theoryCertificate';

describe('theory certificate number', () => {
  it('opens the DVSA lookup', () => {
    expect(THEORY_LOOKUP_URL).toBe('https://www.gov.uk/find-theory-test-pass-number');
  });

  it('keeps only letters and numbers, in capitals, with a length cap', () => {
    expect(cleanCertificateInput(' 1234 5678 ')).toBe('12345678');
    expect(cleanCertificateInput('ab-12/cd')).toBe('AB12CD');
    expect(cleanCertificateInput('x'.repeat(50))).toHaveLength(MAX_CERTIFICATE_CHARS);
    expect(cleanCertificateInput('')).toBe('');
  });

  it('saves nothing for an empty box', () => {
    expect(certificateToSave('  ')).toBeNull();
    expect(certificateToSave(null)).toBeNull();
    expect(certificateToSave('1234 5678')).toBe('12345678');
  });

  it('shows the number in groups of four', () => {
    expect(certificateDisplay('12345678')).toBe('1234 5678');
    expect(certificateDisplay('1234')).toBe('1234');
    expect(certificateDisplay(null)).toBe('');
  });

  it('only applies to a passed theory test', () => {
    expect(certificateApplies('theory', 'pass')).toBe(true);
    expect(certificateApplies('theory', 'fail')).toBe(false);
    expect(certificateApplies('practical', 'pass')).toBe(false);
  });
});
