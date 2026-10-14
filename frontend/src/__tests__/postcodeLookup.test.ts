import { formatPostcode, looksLikePostcode, lookupPostcode } from '../postcodeLookup';

const reply = (status: number, body?: unknown) =>
  jest.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as typeof fetch;

describe('formatPostcode', () => {
  it.each([
    ['sm14ls', 'SM1 4LS'],
    [' SM1  4LS ', 'SM1 4LS'],
    ['w1a1aa', 'W1A 1AA'],
    ['ec1a1bb', 'EC1A 1BB'],
    ['m11ae', 'M1 1AE'],
  ])('%s -> %s', (raw, tidy) => expect(formatPostcode(raw)).toBe(tidy));
});

describe('looksLikePostcode', () => {
  it.each(['SM1 4LS', 'sm14ls', 'W1A 1AA', 'EC1A 1BB', 'M1 1AE', 'DN55 1PT'])('accepts %s', (p) =>
    expect(looksLikePostcode(p)).toBe(true));
  it.each(['', 'hello', '12345', 'SM1', 'SM1 4L', '1M1 4LS'])('rejects "%s"', (p) =>
    expect(looksLikePostcode(p)).toBe(false));
});

describe('lookupPostcode', () => {
  it('returns the tidy postcode and the area when it is found', async () => {
    const f = reply(200, { status: 200, result: { postcode: 'SM1 4LS', admin_district: 'Sutton', admin_county: null, region: 'London' } });
    expect(await lookupPostcode('sm14ls', f)).toEqual({ status: 'found', postcode: 'SM1 4LS', area: 'Sutton, London' });
    expect((f as jest.Mock).mock.calls[0][0]).toBe('https://api.postcodes.io/postcodes/SM1%204LS');
  });

  it('does not repeat an area name that appears twice', async () => {
    const f = reply(200, { result: { postcode: 'M1 1AE', admin_district: 'Manchester', admin_county: 'Manchester', region: 'North West' } });
    expect(await lookupPostcode('M1 1AE', f)).toMatchObject({ area: 'Manchester, North West' });
  });

  it('says not found on a 404, and for something not shaped like a postcode without asking the service', async () => {
    expect(await lookupPostcode('ZZ99 9ZZ', reply(404, { status: 404 }))).toEqual({ status: 'not_found' });
    const f = reply(200, {});
    expect(await lookupPostcode('hello', f)).toEqual({ status: 'not_found' });
    expect(f).not.toHaveBeenCalled();
  });

  it('says unavailable when the service errors, times out or fails to answer', async () => {
    expect(await lookupPostcode('SM1 4LS', reply(500))).toEqual({ status: 'unavailable' });
    expect(await lookupPostcode('SM1 4LS', jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch)).toEqual({ status: 'unavailable' });
    expect(await lookupPostcode('SM1 4LS', reply(200, { result: {} }))).toEqual({ status: 'unavailable' });
  });
});
