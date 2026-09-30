import {
  parseVoucherHours, formatHoursLabel, addMonths, todayKey, voucherStatus,
  formatVoucherDate, isSafeImageUrl, buildVoucherHtml, MAX_VOUCHER_HOURS,
} from '../voucher';

describe('parseVoucherHours', () => {
  it('accepts whole and half hours up to the maximum', () => {
    expect(parseVoucherHours('1')).toBe(1);
    expect(parseVoucherHours('2.5')).toBe(2.5);
    expect(parseVoucherHours(' 10 ')).toBe(10);
    expect(parseVoucherHours('0.5')).toBe(0.5);
    expect(parseVoucherHours(String(MAX_VOUCHER_HOURS))).toBe(MAX_VOUCHER_HOURS);
  });

  it('rejects zero, negatives, too many, odd fractions and non-numbers', () => {
    for (const bad of ['0', '-1', '100.5', '101', '1.25', '0.3', '', 'abc', '1e2', '2,5', '1 hour', '.5']) {
      expect(parseVoucherHours(bad)).toBeNull();
    }
  });
});

describe('formatHoursLabel', () => {
  it('uses the singular only for exactly one hour', () => {
    expect(formatHoursLabel(1)).toBe('1 hour');
    expect(formatHoursLabel(2)).toBe('2 hours');
    expect(formatHoursLabel(1.5)).toBe('1.5 hours');
    expect(formatHoursLabel(0.5)).toBe('0.5 hours');
  });
});

describe('addMonths', () => {
  it('adds calendar months', () => {
    expect(addMonths(new Date(2026, 8, 30), 12)).toBe('2027-09-30');
    expect(addMonths(new Date(2026, 8, 30), 6)).toBe('2027-03-30');
    expect(addMonths(new Date(2026, 8, 30), 24)).toBe('2028-09-30');
  });

  it('pulls a day that does not exist back to the last day of the month, never into the next', () => {
    expect(addMonths(new Date(2026, 0, 31), 1)).toBe('2026-02-28');
    expect(addMonths(new Date(2027, 7, 31), 6)).toBe('2028-02-29');
    expect(addMonths(new Date(2028, 1, 29), 12)).toBe('2029-02-28');
    expect(addMonths(new Date(2026, 4, 31), 1)).toBe('2026-06-30');
  });

  it('rolls over the year end', () => {
    expect(addMonths(new Date(2026, 10, 15), 3)).toBe('2027-02-15');
  });
});

describe('voucherStatus', () => {
  const today = new Date(2026, 8, 30);
  it('reports a live voucher as active, including on its expiry day', () => {
    expect(voucherStatus({ status: 'active', expires_at: '2027-09-30' }, today)).toBe('active');
    expect(voucherStatus({ status: 'active', expires_at: '2026-09-30' }, today)).toBe('active');
  });

  it('reports an active voucher past its expiry as expired', () => {
    expect(voucherStatus({ status: 'active', expires_at: '2026-09-29' }, today)).toBe('expired');
  });

  it('keeps redeemed and cancelled as they are, even after the expiry date', () => {
    expect(voucherStatus({ status: 'redeemed', expires_at: '2020-01-01' }, today)).toBe('redeemed');
    expect(voucherStatus({ status: 'cancelled', expires_at: '2020-01-01' }, today)).toBe('cancelled');
  });

  it('todayKey uses the local calendar date', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('formatVoucherDate', () => {
  it('writes a date in full, UK style', () => {
    expect(formatVoucherDate('2026-09-30')).toBe('30 September 2026');
    expect(formatVoucherDate('2027-02-01')).toBe('1 February 2027');
  });
  it('leaves a non-date untouched', () => {
    expect(formatVoucherDate('soon')).toBe('soon');
  });
});

describe('isSafeImageUrl', () => {
  it('allows ordinary web addresses only', () => {
    expect(isSafeImageUrl('https://cdn.example.co.uk/logo.png')).toBe(true);
    expect(isSafeImageUrl('http://example.com/a.png')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'file:///etc/passwd', '//evil.com/x.png',
      'https://x.com/a.png" onerror="alert(1)', "https://x.com/a.png'>", '', null, undefined]) {
      expect(isSafeImageUrl(bad as any)).toBe(false);
    }
  });
});

const base = {
  code: 'ABCD-EFGH-JKMN', hours: 5, expiresAt: '2027-09-30', issuedAt: new Date(2026, 8, 30),
  instructorName: 'Alex Morgan',
};

describe('buildVoucherHtml', () => {
  it('shows the hours, code, expiry and who to contact', () => {
    const html = buildVoucherHtml({ ...base, businessName: 'Morgan Driving', contactPhone: '07700 900123', contactEmail: 'alex@example.com' });
    expect(html).toContain('5 hours');
    expect(html).toContain('ABCD-EFGH-JKMN');
    expect(html).toContain('30 September 2027');
    expect(html).toContain('Morgan Driving');
    expect(html).toContain('07700 900123');
    expect(html).toContain('Alex Morgan');
  });

  it('uses the singular for a one hour voucher', () => {
    expect(buildVoucherHtml({ ...base, hours: 1 })).toContain('1 hour<');
  });

  it('falls back to the instructor name when there is no business name', () => {
    const html = buildVoucherHtml({ ...base, businessName: '   ' });
    expect(html).toContain('<div class="brand">Alex Morgan</div>');
  });

  it('includes the logo only when it is a safe web address', () => {
    expect(buildVoucherHtml({ ...base, logoUrl: 'https://cdn.example.co.uk/logo.png' })).toContain('<img src="https://cdn.example.co.uk/logo.png"');
    expect(buildVoucherHtml({ ...base, logoUrl: 'javascript:alert(1)' })).not.toContain('<img');
    expect(buildVoucherHtml({ ...base, logoUrl: null })).not.toContain('<img');
  });

  it('shows the recipient and message only when given', () => {
    expect(buildVoucherHtml(base)).not.toContain('This voucher is for');
    const html = buildVoucherHtml({ ...base, recipientName: 'Sam Taylor', message: 'Happy birthday!' });
    expect(html).toContain('This voucher is for<strong>Sam Taylor</strong>');
    expect(html).toContain('Happy birthday!');
  });

  it('escapes every piece of user-supplied text', () => {
    const html = buildVoucherHtml({
      ...base,
      businessName: '<script>alert(1)</script>',
      recipientName: '"><img src=x onerror=alert(1)>',
      message: '<b>hi</b>',
      instructorName: '<i>Alex</i>',
      contactEmail: 'a@b.co<script>',
      address: '<u>1 Road</u>',
      logoUrl: 'https://x.com/logo.png',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>hi</b>');
    expect(html).not.toContain('<i>Alex</i>');
    expect(html).not.toContain('<u>1 Road</u>');
    expect(html).not.toContain('onerror=alert(1)>');
    expect(html).toContain('&lt;script&gt;');
  });
});
