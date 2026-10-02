import {
  withTimeout, raceTimeout, TimeoutError, isTimeoutError, loadErrorMessage, SLOW_LOAD_MESSAGE,
} from '../withTimeout';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('withTimeout (fallback version, used by biometrics)', () => {
  it('returns the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'fallback')).resolves.toBe('ok');
  });

  it('returns the fallback for a stall and for a failure alike', async () => {
    const stalled = withTimeout(new Promise<string>(() => {}), 1000, 'fallback');
    jest.advanceTimersByTime(1000);
    await expect(stalled).resolves.toBe('fallback');
    await expect(withTimeout(Promise.reject(new Error('x')), 1000, 'fallback')).resolves.toBe('fallback');
  });
});

describe('raceTimeout (error-preserving version, used for data loads)', () => {
  it('passes a successful result straight through', async () => {
    await expect(raceTimeout(Promise.resolve([1, 2]), 15000)).resolves.toEqual([1, 2]);
  });

  it('passes a real error through untouched, as a real error, not a timeout', async () => {
    const real = new Error('permission denied for table students');
    const err = await raceTimeout(Promise.reject(real), 15000).catch((e) => e);
    expect(err).toBe(real);
    expect(isTimeoutError(err)).toBe(false);
  });

  it('rejects with a TimeoutError only when the promise never settles', async () => {
    const stalled = raceTimeout(new Promise<string>(() => {}), 15000);
    const caught = stalled.catch((e) => e);
    jest.advanceTimersByTime(14999);
    let settled = false;
    caught.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    const err = await caught;
    expect(err).toBeInstanceOf(TimeoutError);
    expect(isTimeoutError(err)).toBe(true);
  });

  it('cancels its timer once the promise settles, leaving nothing pending', async () => {
    await raceTimeout(Promise.resolve('ok'), 15000);
    await raceTimeout(Promise.reject(new Error('x')), 15000).catch(() => {});
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a late result after the timeout is ignored rather than throwing', async () => {
    let resolveLate: (v: string) => void = () => {};
    const late = new Promise<string>((r) => { resolveLate = r; });
    const raced = raceTimeout(late, 1000).catch((e) => e);
    jest.advanceTimersByTime(1000);
    expect(isTimeoutError(await raced)).toBe(true);
    expect(() => resolveLate('too late')).not.toThrow();
  });
});

describe('loadErrorMessage', () => {
  it('uses the slow-connection message only for a timeout', () => {
    expect(loadErrorMessage(new TimeoutError(15000), 'fallback')).toBe(SLOW_LOAD_MESSAGE);
  });

  it('keeps a real error\'s own message', () => {
    expect(loadErrorMessage(new Error('JWT expired'), 'fallback')).toBe('JWT expired');
    expect(loadErrorMessage({ message: 'row-level security' }, 'fallback')).toBe('row-level security');
  });

  it('falls back when there is no usable message', () => {
    expect(loadErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(loadErrorMessage(null, 'fallback')).toBe('fallback');
    expect(loadErrorMessage(new Error('   '), 'fallback')).toBe('fallback');
    expect(loadErrorMessage('plain string', 'fallback')).toBe('fallback');
  });
});
