// The "last opened" stamp goes through the stamp_my_activity RPC (pupils can't update students directly)
// and never throws.
const mockRpc = jest.fn();
jest.mock('../supabaseClient', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

import { stampStudentActivity } from '../supabaseDb';

beforeEach(() => mockRpc.mockReset().mockResolvedValue({ error: null }));

it('calls the stamp_my_activity function', async () => {
  await stampStudentActivity('u1');
  expect(mockRpc).toHaveBeenCalledWith('stamp_my_activity');
});

it('never throws, even if the call fails', async () => {
  mockRpc.mockRejectedValue(new Error('offline'));
  await expect(stampStudentActivity('u1')).resolves.toBeUndefined();
});
