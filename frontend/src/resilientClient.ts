// Two guards for the Supabase client on a phone, aimed at the app sitting on a spinner (or a blank Diary and
// Students) after it has been in the background. Server logs showed the phone sending nothing at all for over a
// minute, then everything loading instantly once the app was restarted: the wait was inside the phone.
//
// 1. withFetchTimeout: a request on a dead connection (common after the phone has been away) can hang for minutes,
//    and while the login renewal is hanging every other request queues behind it. Sign-in and data requests now
//    give up after a time limit, so the next try opens a fresh connection.
// 2. withMemoryCache: the session is read from the phone's secure storage on every request. If one read stalls,
//    everything stalls. After the first successful read or write, the session is served from memory; writes still
//    go to secure storage (waited for, up to a limit, so a rotated login is not lost).

export const AUTH_FETCH_TIMEOUT_MS = 10_000;
export const REST_FETCH_TIMEOUT_MS = 20_000;
export const STORAGE_READ_TIMEOUT_MS = 4_000;
export const STORAGE_WRITE_WAIT_MS = 5_000;

type FetchLike = (input: any, init?: any) => Promise<any>;

/** The time limit for this request, or null when it should not be limited (uploads, downloads, other services). */
export function fetchTimeoutFor(url: string): number | null {
  if (url.includes('/auth/v1/')) return AUTH_FETCH_TIMEOUT_MS;
  if (url.includes('/rest/v1/')) return REST_FETCH_TIMEOUT_MS;
  return null;
}

export function withFetchTimeout(baseFetch: FetchLike): FetchLike {
  return async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const limit = fetchTimeoutFor(url);
    if (limit == null) return baseFetch(input, init);

    const controller = new AbortController();
    const outer: AbortSignal | undefined = init?.signal;
    const onOuterAbort = () => controller.abort();
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener?.('abort', onOuterAbort);
    }
    const timer = setTimeout(() => controller.abort(), limit);
    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener?.('abort', onOuterAbort);
    }
  };
}

type StorageLike = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};

function limit<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function withMemoryCache(
  inner: StorageLike,
  opts: { readTimeoutMs?: number; writeWaitMs?: number } = {},
): StorageLike {
  const readTimeout = opts.readTimeoutMs ?? STORAGE_READ_TIMEOUT_MS;
  const writeWait = opts.writeWaitMs ?? STORAGE_WRITE_WAIT_MS;
  const cache = new Map<string, string | null>();

  return {
    async getItem(key) {
      if (cache.has(key)) return cache.get(key) ?? null;
      // Throws on a stall rather than answering "nothing stored", which would look like being signed out.
      const value = await limit(Promise.resolve(inner.getItem(key)), readTimeout, 'Reading the saved login');
      cache.set(key, value ?? null);
      return value ?? null;
    },
    async setItem(key, value) {
      cache.set(key, value);
      try { await limit(Promise.resolve(inner.setItem(key, value)), writeWait, 'Saving the login'); } catch { /* memory has it; storage may still finish */ }
    },
    async removeItem(key) {
      cache.set(key, null);
      try { await limit(Promise.resolve(inner.removeItem(key)), writeWait, 'Clearing the login'); } catch { /* ignore */ }
    },
  };
}
