const mockResults: Record<string, { data: any[] | null; error: any }> = {};
function mockChain(table: string) {
  const c: any = {
    select: () => c,
    eq: () => c,
    order: () => c,
    then: (res: any, rej: any) => Promise.resolve(mockResults[table]).then(res, rej),
  };
  return c;
}
jest.mock('../supabaseClient', () => ({ supabase: { from: (t: string) => mockChain(t) } }));

import { listBlockBookings } from '../supabaseDb';

const row = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id, student_id: 's1', hours_paid: '2.00', hours_used: '0.00', amount: String(amount), purchased_at: '2026-10-22T20:09:13Z', notes: null, ...extra,
});

describe('listBlockBookings and the money behind the hours (Migration 089)', () => {
  it('shows the payment amount for hours added with a payment, and the block amount otherwise', async () => {
    mockResults.block_bookings_with_money = {
      data: [row('linked', 0, { money_gbp: '80.00' }), row('bought', 72, { money_gbp: '72.00' })],
      error: null,
    };
    const out = await listBlockBookings('s1');
    expect(out.map((b) => [b.id, b.amount, b.money])).toEqual([['linked', 0, 80], ['bought', 72, 72]]);
  });

  it('falls back to the plain table when the view cannot be read, using each block\'s own amount', async () => {
    mockResults.block_bookings_with_money = { data: null, error: { message: 'relation does not exist' } };
    mockResults.block_bookings = { data: [row('a', 80)], error: null };
    const out = await listBlockBookings('s1');
    expect(out).toHaveLength(1);
    expect(out[0].money).toBe(80);
  });

  it('fails when neither can be read', async () => {
    mockResults.block_bookings_with_money = { data: null, error: { message: 'x' } };
    mockResults.block_bookings = { data: null, error: { message: 'permission denied' } };
    await expect(listBlockBookings('s1')).rejects.toEqual({ message: 'permission denied' });
  });
});
