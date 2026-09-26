import { instructorBootstrapArgsFromAuthUser } from '../authBootstrap';

const base = { id: 'u1', email: 'sam@example.com' };

describe('instructorBootstrapArgsFromAuthUser', () => {
  it('returns args for a self-registered instructor', () => {
    expect(
      instructorBootstrapArgsFromAuthUser({
        ...base,
        user_metadata: { role: 'instructor', name: 'Sam Jones', adi_number: '123456', referral_code: 'abc234' },
      }),
    ).toEqual({
      authUserId: 'u1',
      email: 'sam@example.com',
      name: 'Sam Jones',
      adi_number: '123456',
      referralCode: 'ABC234', // normalised to upper case
    });
  });

  it('omits referralCode when none was entered', () => {
    const r = instructorBootstrapArgsFromAuthUser({
      ...base,
      user_metadata: { role: 'instructor', name: 'Sam', adi_number: '123456', referral_code: '  ' },
    });
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('referralCode');
  });

  it('never bootstraps a student', () => {
    expect(
      instructorBootstrapArgsFromAuthUser({ ...base, user_metadata: { role: 'student', name: 'Sam', adi_number: '123456' } }),
    ).toBeNull();
  });

  it('never bootstraps an instructor added by a school owner (no ADI number in metadata)', () => {
    expect(
      instructorBootstrapArgsFromAuthUser({ ...base, user_metadata: { role: 'instructor', name: 'Sam' } }),
    ).toBeNull();
  });

  it('returns null when there is no role or no metadata at all', () => {
    expect(instructorBootstrapArgsFromAuthUser({ ...base, user_metadata: {} })).toBeNull();
    expect(instructorBootstrapArgsFromAuthUser({ ...base, user_metadata: null })).toBeNull();
    expect(instructorBootstrapArgsFromAuthUser({ ...base })).toBeNull();
  });

  it('accepts a numeric ADI number and trims a string one', () => {
    expect(
      instructorBootstrapArgsFromAuthUser({ ...base, user_metadata: { role: 'instructor', name: 'Sam', adi_number: 123456 } })?.adi_number,
    ).toBe('123456');
    expect(
      instructorBootstrapArgsFromAuthUser({ ...base, user_metadata: { role: 'instructor', name: 'Sam', adi_number: ' 123456 ' } })?.adi_number,
    ).toBe('123456');
  });

  it('rejects a blank ADI number', () => {
    expect(
      instructorBootstrapArgsFromAuthUser({ ...base, user_metadata: { role: 'instructor', name: 'Sam', adi_number: '   ' } }),
    ).toBeNull();
  });

  it('falls back to full_name, then the email prefix, for the name', () => {
    expect(
      instructorBootstrapArgsFromAuthUser({ ...base, user_metadata: { role: 'instructor', full_name: 'Sam Full', adi_number: '1' } })?.name,
    ).toBe('Sam Full');
    expect(
      instructorBootstrapArgsFromAuthUser({ ...base, user_metadata: { role: 'instructor', adi_number: '1' } })?.name,
    ).toBe('sam');
  });
});
