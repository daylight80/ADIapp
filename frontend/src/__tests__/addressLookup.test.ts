import { suggestAddresses, addressForSuggestion, combineAddress, worthSearching } from '../addressLookup';

jest.mock('../api', () => ({ api: { post: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('../api');

beforeEach(() => api.post.mockReset());

describe('worthSearching', () => {
  it('needs three characters', () => {
    expect(worthSearching('sm')).toBe(false);
    expect(worthSearching('  sm ')).toBe(false);
    expect(worthSearching('sm1')).toBe(true);
  });
});

describe('suggestAddresses', () => {
  it('does not call the server for short text', async () => {
    expect(await suggestAddresses('sm')).toEqual({ suggestions: [], available: true });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('returns the suggestions from the server', async () => {
    api.post.mockResolvedValue({ data: { suggestions: [{ place_id: 'p1', text: '1 High St' }], available: true } });
    const r = await suggestAddresses(' 1 high st ');
    expect(api.post).toHaveBeenCalledWith('/maps/address-suggest', { query: '1 high st' });
    expect(r.suggestions).toHaveLength(1);
    expect(r.available).toBe(true);
  });

  it('says the service is unavailable when the server cannot reach Google', async () => {
    api.post.mockResolvedValue({ data: { suggestions: [], available: false } });
    expect((await suggestAddresses('high street')).available).toBe(false);
  });

  it('never throws: a network failure is just "unavailable"', async () => {
    api.post.mockRejectedValue(new Error('network'));
    expect(await suggestAddresses('high street')).toEqual({ suggestions: [], available: false });
  });
});

describe('addressForSuggestion', () => {
  it('tidies the postcode', async () => {
    api.post.mockResolvedValue({ data: { address: '12 Abbey Road, London', postcode: 'nw89ay' } });
    expect(await addressForSuggestion('p1')).toEqual({ address: '12 Abbey Road, London', postcode: 'NW8 9AY' });
  });
  it('is null when the address cannot be fetched', async () => {
    api.post.mockRejectedValue(new Error('502'));
    expect(await addressForSuggestion('p1')).toBeNull();
    api.post.mockResolvedValue({ data: { address: '', postcode: '' } });
    expect(await addressForSuggestion('p1')).toBeNull();
  });
});

describe('combineAddress', () => {
  it('joins address and postcode, skipping an empty part', () => {
    expect(combineAddress('1 High St', 'SM1 1AA')).toBe('1 High St, SM1 1AA');
    expect(combineAddress('1 High St', '')).toBe('1 High St');
    expect(combineAddress(null, 'SM1 1AA')).toBe('SM1 1AA');
  });
});
