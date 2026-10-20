import { createAuthLifecycle, RESUME_REFRESH_AFTER_MS, RESUME_REFRESH_TIMEOUT_MS } from '../appLifecycle';

function setup(getSession: () => Promise<unknown> = async () => ({})) {
  let t = 1_000_000;
  const auth = { startAutoRefresh: jest.fn(async () => {}), stopAutoRefresh: jest.fn(async () => {}), getSession: jest.fn(getSession) };
  const onResume = jest.fn();
  const lc = createAuthLifecycle({ auth, onResume, now: () => t });
  return { auth, onResume, lc, advance: (ms: number) => { t += ms; } };
}

describe('auth lifecycle', () => {
  it('stops renewing the login in the background and starts again on return', async () => {
    const { auth, lc } = setup();
    await lc.onChange('background');
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    await lc.onChange('active');
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('after a real absence it renews the login and reloads the lists', async () => {
    const { auth, lc, advance, onResume } = setup();
    await lc.onChange('background');
    advance(RESUME_REFRESH_AFTER_MS + 1000);
    await lc.onChange('active');
    expect(auth.getSession).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('a quick switch (a call, the fingerprint prompt) does not reload anything', async () => {
    const { auth, lc, advance, onResume } = setup();
    await lc.onChange('background');
    advance(5000);
    await lc.onChange('active');
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('ignores the in-between inactive state', async () => {
    const { auth, lc, onResume } = setup();
    await lc.onChange('inactive');
    expect(auth.stopAutoRefresh).not.toHaveBeenCalled();
    expect(auth.startAutoRefresh).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('carries on and still reloads if renewing the login fails', async () => {
    const { lc, advance, onResume } = setup(async () => { throw new Error('network'); });
    await lc.onChange('background');
    advance(RESUME_REFRESH_AFTER_MS + 1);
    await lc.onChange('active');
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('does not wait forever for a stuck login renewal', async () => {
    jest.useFakeTimers();
    try {
      const { lc, advance, onResume } = setup(() => new Promise(() => {}));
      await lc.onChange('background');
      advance(RESUME_REFRESH_AFTER_MS + 1);
      const done = lc.onChange('active');
      await jest.advanceTimersByTimeAsync(RESUME_REFRESH_TIMEOUT_MS + 100);
      await done;
      expect(onResume).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
