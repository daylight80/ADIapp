jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));

import { buildInvoiceHtml } from '../invoice';

const lesson = (amount: number) => ({ id: `l${amount}`, date: '2026-10-01', topic: 'Roundabouts', duration_hours: 1, amount_paid: amount });

const build = (amounts: number[]) =>
  buildInvoiceHtml({
    invoiceNo: 'INV-1',
    instructorName: 'Grant Robery',
    instructorEmail: 'grant@example.com',
    student: { name: 'Test Pupil', email: 'p@example.com', address: '1 High St', postcode: 'AB1 2CD' } as any,
    lessons: amounts.map(lesson) as any,
    issuedAt: new Date('2026-10-14T10:00:00Z'),
  });

describe('invoice totals', () => {
  it('adds no VAT: the total is what the lessons cost', () => {
    const html = build([36, 36, 40]);
    expect(html).not.toMatch(/VAT/i);
    expect(html).not.toMatch(/Subtotal/);
    expect(html).toContain('<span>Total</span><span>£112.00</span>');
  });

  it('shows £0.00 for an invoice with no lessons', () => {
    expect(build([])).toContain('<span>Total</span><span>£0.00</span>');
  });

  it('keeps pennies exact', () => {
    expect(build([33.33, 33.33, 33.34])).toContain('<span>Total</span><span>£100.00</span>');
  });
});
