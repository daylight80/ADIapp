// The optional pass photo/video consent goes through the two RPCs and reports failures instead of hiding them.
const mockRpc = jest.fn();
jest.mock('../supabaseClient', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

import { getMyMediaConsent, setMyMediaConsent } from '../supabaseDb';

beforeEach(() => mockRpc.mockReset());

it('reads the saved choice', async () => {
  mockRpc.mockResolvedValue({ data: true, error: null });
  expect(await getMyMediaConsent()).toBe(true);
  expect(mockRpc).toHaveBeenCalledWith('get_my_media_consent');
});

it('treats nothing saved as no consent', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null });
  expect(await getMyMediaConsent()).toBe(false);
});

it.each([true, false])('saves %s', async (value) => {
  mockRpc.mockResolvedValue({ data: value, error: null });
  expect(await setMyMediaConsent(value)).toBe(value);
  expect(mockRpc).toHaveBeenCalledWith('set_my_media_consent', { p_consent: value });
});

it('throws when saving fails, so the screen can undo the tick', async () => {
  mockRpc.mockResolvedValue({ data: null, error: new Error('nope') });
  await expect(setMyMediaConsent(true)).rejects.toThrow('nope');
});
