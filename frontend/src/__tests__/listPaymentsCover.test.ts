const mockQueries: Record<string, { data: any[] | null; error: any }> = {};
function mockChain(table: string) {
  const c: any = {
    select: () => c,
    eq: () => c,
    order: () => c,
    then: (res: any, rej: any) => Promise.resolve(mockQueries[table]).then(res, rej),
  };
  return c;
}
jest.mock('../supabaseClient', () => ({ supabase: { from: (t: string) => mockChain(t) } }));

import { listPayments } from '../supabaseDb';

const row = (id: string) => ({ id, amount: '80.00', method: 'bank_transfer', paid_at: '2026-10-22T15:15:00Z', source: 'lesson' });

describe('listPayments and prepaid cover (Migration 088)', () => {
  beforeEach(() => {
    mockQueries.payments = { data: [row('a'), row('b')], error: null };
    mockQueries.payment_prepaid_cover = { data: [{ payment_id: 'a' }], error: null };
  });

  it('marks the payments that prepaid hours cover', async () => {
    const out = await listPayments('s1');
    expect(out.map((p) => [p.id, p.covered_by_prepaid])).toEqual([['a', true], ['b', false]]);
    expect(out[0].amount).toBe(80);
  });

  it('still lists the payments, without the note, when the cover lookup fails', async () => {
    mockQueries.payment_prepaid_cover = { data: null, error: { message: 'relation does not exist' } };
    const out = await listPayments('s1');
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.covered_by_prepaid === false)).toBe(true);
  });

  it('fails when the payments themselves cannot be read', async () => {
    mockQueries.payments = { data: null, error: { message: 'permission denied' } };
    await expect(listPayments('s1')).rejects.toEqual({ message: 'permission denied' });
  });
});
