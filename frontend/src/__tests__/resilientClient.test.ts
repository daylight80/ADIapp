import {
  withFetchTimeout, withMemoryCache, fetchTimeoutFor, AUTH_FETCH_TIMEOUT_MS, REST_FETCH_TIMEOUT_MS,
} from '../resilientClient';

describe('fetchTimeoutFor', () => {
  it('limits sign-in and data requests, and nothing else', () => {
    expect(fetchTimeoutFor('https://x.supabase.co/auth/v1/token?grant_type=refresh_token')).toBe(AUTH_FETCH_TIMEOUT_MS);
    expect(fetchTimeoutFor('https://x.supabase.co/rest/v1/lessons?select=*')).toBe(REST_FETCH_TIMEOUT_MS);
    expect(fetchTimeoutFor('https://x.supabase.co/storage/v1/object/photos/a.jpg')).toBeNull();
    expect(fetchTimeoutFor('https://x.supabase.co/functions/v1/ai')).toBeNull();
  });
});

describe('withFetchTimeout', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  /** A fetch that never answers, and rejects when aborted. */
  const hangingFetch = () => jest.fn((_url: any, init?: any) => new Promise((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));

  it('gives up on a hung sign-in request after the limit', async () => {
    const f = withFetchTimeout(hangingFetch());
    const p = f('https://x.supabase.co/auth/v1/token', {});
    const outcome = p.then(() => 'answered', (e) => e.name);
    await jest.advanceTimersByTimeAsync(AUTH_FETCH_TIMEOUT_MS + 1);
    await expect(outcome).resolves.toBe('AbortError');
  });

  it('does not limit uploads', async () => {
    const base = jest.fn(async () => 'ok');
    await expect(withFetchTimeout(base)('https://x.supabase.co/storage/v1/object/a', {})).resolves.toBe('ok');
    expect((base.mock.calls[0] as any[])[1].signal).toBeUndefined();
  });

  it('passes a quick answer straight through and cancels the timer', async () => {
    const base = jest.fn(async () => 'fine');
    await expect(withFetchTimeout(base)('https://x.supabase.co/rest/v1/lessons', {})).resolves.toBe('fine');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('still honours the caller’s own cancel', async () => {
    const outer = new AbortController();
    const f = withFetchTimeout(hangingFetch());
    const outcome = f('https://x.supabase.co/rest/v1/lessons', { signal: outer.signal }).then(() => 'answered', (e) => e.name);
    outer.abort();
    await expect(outcome).resolves.toBe('AbortError');
  });
});

describe('withMemoryCache', () => {
  const makeInner = (initial: Record<string, string> = {}) => {
    const data: Record<string, string> = { ...initial };
    return {
      data,
      getItem: jest.fn(async (k: string) => (k in data ? data[k] : null)),
      setItem: jest.fn(async (k: string, v: string) => { data[k] = v; }),
      removeItem: jest.fn(async (k: string) => { delete data[k]; }),
    };
  };

  it('reads storage once, then answers from memory', async () => {
    const inner = makeInner({ s: 'session' });
    const store = withMemoryCache(inner);
    expect(await store.getItem('s')).toBe('session');
    expect(await store.getItem('s')).toBe('session');
    expect(inner.getItem).toHaveBeenCalledTimes(1);
  });

  it('keeps working from memory if storage then stalls, and still writes through', async () => {
    const inner = makeInner({ s: 'old' });
    const store = withMemoryCache(inner);
    await store.getItem('s');
    inner.getItem.mockImplementation(() => new Promise(() => {}));
    await store.setItem('s', 'new');
    expect(inner.data.s).toBe('new');
    expect(await store.getItem('s')).toBe('new');
  });

  it('remembers a removal', async () => {
    const inner = makeInner({ s: 'x' });
    const store = withMemoryCache(inner);
    await store.getItem('s');
    await store.removeItem('s');
    expect(await store.getItem('s')).toBeNull();
    expect(inner.data.s).toBeUndefined();
  });

  it('errors, rather than saying "nothing stored", when the very first read stalls', async () => {
    const inner = makeInner();
    inner.getItem.mockImplementation(() => new Promise(() => {}));
    const store = withMemoryCache(inner, { readTimeoutMs: 20 });
    await expect(store.getItem('s')).rejects.toThrow(/timed out/);
  });

  it('does not hold the caller up for long if a write stalls', async () => {
    const inner = makeInner();
    inner.setItem.mockImplementation(() => new Promise(() => {}));
    const store = withMemoryCache(inner, { writeWaitMs: 20 });
    await expect(store.setItem('s', 'v')).resolves.toBeUndefined();
    expect(await store.getItem('s')).toBe('v');
  });
});
