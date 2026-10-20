import {
  parseAmount, formatGbp, describeBalance, pupilBalanceLine, methodLabel, paymentSubline, activePayments,
  paymentErrorMessage, buildReceiptHtml, pupilHistory,
} from '../payments';

describe('parseAmount', () => {
  it('reads pounds as typed', () => {
    expect(parseAmount('36')).toBe(36);
    expect(parseAmount('£36.50')).toBe(36.5);
    expect(parseAmount(' 1,200 ')).toBe(1200);
    expect(parseAmount('0.01')).toBe(0.01);
    expect(parseAmount('10000')).toBe(10000);
  });
  it('refuses anything that is not a sensible payment', () => {
    for (const bad of ['', 'abc', '0', '-5', '12.345', '10000.01', '1e3', '1..2', null, undefined]) {
      expect(parseAmount(bad as any)).toBeNull();
    }
  });
});

describe('formatGbp', () => {
  it('shows pounds and pence with separators, never a minus sign', () => {
    expect(formatGbp(36)).toBe('£36.00');
    expect(formatGbp(1234.5)).toBe('£1,234.50');
    expect(formatGbp(-24)).toBe('£24.00');
    expect(formatGbp(0.1 + 0.2)).toBe('£0.30');
  });
});

describe('describeBalance', () => {
  it('says who owes whom', () => {
    expect(describeBalance(46)).toEqual({ kind: 'owes', amount: 46, label: 'Owes £46.00' });
    expect(describeBalance(-24)).toEqual({ kind: 'credit', amount: 24, label: '£24.00 in credit' });
    expect(describeBalance(0)).toEqual({ kind: 'clear', amount: 0, label: 'Up to date' });
  });
  it('treats less than a penny as settled and copes with nothing', () => {
    expect(describeBalance(0.004).kind).toBe('clear');
    expect(describeBalance(-0.003).kind).toBe('clear');
    expect(describeBalance(null).kind).toBe('clear');
    expect(describeBalance(undefined).kind).toBe('clear');
  });
});

describe('pupilBalanceLine', () => {
  it('speaks to the pupil', () => {
    expect(pupilBalanceLine(46, 'Grant')).toBe('You owe £46.00 to Grant.');
    expect(pupilBalanceLine(46)).toBe('You owe £46.00.');
    expect(pupilBalanceLine(-10, 'Grant')).toBe('You have £10.00 in credit.');
    expect(pupilBalanceLine(0, 'Grant')).toBe('You are all paid up.');
  });
});

describe('payment rows', () => {
  const p = (id: string, paid_at: string, extra: object = {}) => ({ id, amount: 10, method: 'cash', paid_at, ...extra });

  it('labels methods', () => {
    expect(methodLabel('bank_transfer')).toBe('Bank transfer');
    expect(methodLabel('cash')).toBe('Cash');
    expect(methodLabel('mystery')).toBe('Payment');
    expect(methodLabel(null)).toBe('Payment');
  });

  it('describes a payment in one line', () => {
    expect(paymentSubline(p('a', '2026-10-14T10:00:00Z', { reference: 'ABC' }))).toBe('Cash · 14-10-2026 · ref ABC');
    expect(paymentSubline(p('a', '2026-10-14T10:00:00Z'))).toBe('Cash · 14-10-2026');
  });

  it('keeps counted payments only, newest first', () => {
    const rows = [p('old', '2026-09-01T10:00:00Z'), p('void', '2026-10-01T10:00:00Z', { voided_at: '2026-10-02T00:00:00Z' }), p('new', '2026-10-10T10:00:00Z')];
    expect(activePayments(rows).map((r) => r.id)).toEqual(['new', 'old']);
  });
});

describe('pupilHistory', () => {
  it('lists payments and wallet top-ups together, newest first', () => {
    const list = pupilHistory({
      payments: [{ id: 'a', amount: 36, method: 'cash', paid_at: '2026-10-10T10:00:00Z', reference: null }],
      topups: [
        { id: 'k', amount: 108, hours: 3, at: '2026-10-12T10:00:00Z', method: 'bank_transfer' },
        { id: 'j', amount: 36, hours: 1, at: '2026-08-01T10:00:00Z', method: null },
      ],
    });
    expect(list.map((e) => e.id)).toEqual(['t-k', 'p-a', 't-j']);
    expect(list[0]).toMatchObject({ kind: 'topup', title: 'Prepaid 3 hours', amount: 108, sub: 'Bank transfer · 12-10-2026' });
    expect(list[1]).toMatchObject({ kind: 'payment', title: 'Payment', sub: 'Cash · 10-10-2026' });
    expect(list[2].title).toBe('Prepaid 1 hour');
    expect(list[2].sub).toBe('01-08-2026');
  });

  it('is empty when there is nothing yet', () => {
    expect(pupilHistory({ payments: [], topups: [] })).toEqual([]);
  });
});

describe('paymentErrorMessage', () => {
  it('shows the database’s own wording for problems it explains', () => {
    expect(paymentErrorMessage({ code: '22023', message: 'Choose how it was paid.' })).toBe('Choose how it was paid.');
    expect(paymentErrorMessage({ code: '42501', message: 'You can only record payments for your own pupils.' })).toMatch(/own pupils/);
    expect(paymentErrorMessage({ code: '28000' })).toMatch(/sign in again/);
    expect(paymentErrorMessage(new Error('fetch failed'))).toMatch(/Check your connection/);
  });
});

describe('buildReceiptHtml', () => {
  const base = {
    receiptNo: 'R-1', amount: 72, method: 'bank_transfer', paidAt: '2026-10-14T10:00:00Z', studentName: 'Test Pupil',
    instructorName: 'Grant Robery', issuedAt: new Date('2026-10-15T09:00:00Z'),
  };

  it('shows the amount, method, pupil and no VAT', () => {
    const html = buildReceiptHtml({ ...base, reference: 'INV 42', schoolName: "Grant's Driving School" });
    expect(html).toContain('£72.00');
    expect(html).toContain('Bank transfer');
    expect(html).toContain('Test Pupil');
    expect(html).toContain('INV 42');
    expect(html).toContain("Grant's Driving School");
    expect(html).not.toMatch(/VAT/i);
  });

  it('escapes everything typed by a person', () => {
    const html = buildReceiptHtml({ ...base, studentName: '<img src=x onerror=alert(1)>', note: '<script>x</script>' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x');
  });

  it('only uses an ordinary web address as the logo', () => {
    expect(buildReceiptHtml({ ...base, schoolLogoUrl: 'javascript:alert(1)' })).not.toContain('javascript:');
    expect(buildReceiptHtml({ ...base, schoolLogoUrl: 'https://example.com/l.png' })).toContain('https://example.com/l.png');
  });
});

describe('payment date helpers', () => {
  const { paymentDateKey, paidAtForDay, isFutureDay } = require('../payments');
  it('turns a stored time into the local day for a picker', () => {
    expect(paymentDateKey(new Date(2026, 9, 9, 10, 0).toISOString())).toBe('2026-10-09');
  });
  it('stores a picked day at midday so it cannot slip a day', () => {
    expect(new Date(paidAtForDay('2026-10-05')).getHours()).toBe(12);
    expect(paidAtForDay('')).toBeNull();
    expect(paidAtForDay('5/10/2026')).toBeNull();
    expect(paidAtForDay('2026-13-45')).toBeNull();
  });
  it('knows a day later than today', () => {
    expect(isFutureDay('2026-10-16', '2026-10-15')).toBe(true);
    expect(isFutureDay('2026-10-15', '2026-10-15')).toBe(false);
    expect(isFutureDay('2026-10-01', '2026-10-15')).toBe(false);
  });
});
