// Redeeming goes through one database function and passes its errors on, so the pupil sees why.
const mockRpc = jest.fn();
jest.mock('../supabaseClient', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

import { redeemGiftVoucher } from '../supabaseDb';

beforeEach(() => mockRpc.mockReset());

it('sends the code and returns the hours added and the new balance', async () => {
  mockRpc.mockResolvedValue({ data: [{ voucher_hours: '2.00', new_balance: '5.00' }], error: null });
  expect(await redeemGiftVoucher('K7XM-4PQD-9RTA')).toEqual({ hours: 2, balance: 5 });
  expect(mockRpc).toHaveBeenCalledWith('redeem_gift_voucher', { p_code: 'K7XM-4PQD-9RTA' });
});

it('passes the database error on (already used, expired, not recognised)', async () => {
  const err = { code: 'P0001', message: 'This voucher has already been used.' };
  mockRpc.mockResolvedValue({ data: null, error: err });
  await expect(redeemGiftVoucher('K7XM-4PQD-9RTA')).rejects.toBe(err);
});

it('does not pretend it worked when nothing comes back', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  await expect(redeemGiftVoucher('K7XM-4PQD-9RTA')).rejects.toThrow(/Could not redeem/);
});
