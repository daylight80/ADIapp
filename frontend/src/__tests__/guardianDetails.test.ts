import { validateGuardian, hasGuardian, telHref } from '../guardianDetails';

describe('validateGuardian', () => {
  it('accepts nothing at all', () => {
    expect(validateGuardian({ name: '', phone: '', email: '' })).toEqual({ ok: true, values: { name: '', phone: '', email: '' } });
    expect(validateGuardian({ name: '  ', phone: ' ', email: ' ' }).ok).toBe(true);
  });

  it('accepts a name with a phone, an email, or both', () => {
    expect(validateGuardian({ name: 'Jo  Smith', phone: '07700 900123', email: '' })).toEqual({ ok: true, values: { name: 'Jo Smith', phone: '07700 900123', email: '' } });
    expect(validateGuardian({ name: 'Jo Smith', phone: '', email: 'Jo@Example.com' })).toEqual({ ok: true, values: { name: 'Jo Smith', phone: '', email: 'jo@example.com' } });
  });

  it('needs a name when anything else is given', () => {
    const r = validateGuardian({ name: '', phone: '07700 900123', email: '' });
    expect(r.ok).toBe(false);
  });

  it('needs a way to reach them when a name is given', () => {
    const r = validateGuardian({ name: 'Jo Smith', phone: '', email: '' });
    expect(r).toEqual({ ok: false, error: 'Add a phone number or an email for the parent or guardian.' });
  });

  it('rejects a bad phone number or email', () => {
    expect(validateGuardian({ name: 'Jo', phone: 'abc', email: '' }).ok).toBe(false);
    expect(validateGuardian({ name: 'Jo', phone: '', email: 'not-an-email' }).ok).toBe(false);
    expect(validateGuardian({ name: 'J'.repeat(101), phone: '07700 900123', email: '' }).ok).toBe(false);
  });
});

describe('hasGuardian / telHref', () => {
  it('knows when any guardian detail is set', () => {
    expect(hasGuardian({})).toBe(false);
    expect(hasGuardian({ guardian_name: ' ' })).toBe(false);
    expect(hasGuardian({ guardian_phone: '07700 900123' })).toBe(true);
  });
  it('makes a tel link without spaces or brackets', () => {
    expect(telHref('07700 900-123')).toBe('tel:07700900123');
    expect(telHref('+44 (0)7700 900123')).toBe('tel:+4407700900123');
  });
});
