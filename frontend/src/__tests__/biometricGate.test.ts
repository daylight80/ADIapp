import { needsBiometricUnlock, isUnlockExpired, UNLOCK_WINDOW_MS } from '../biometricGate';

describe('needsBiometricUnlock', () => {
  it('asks for the fingerprint when reopening or resuming with unlock turned on', () => {
    expect(needsBiometricUnlock(true, false)).toBe(true);
  });

  it('does not ask straight after the user has typed their password', () => {
    expect(needsBiometricUnlock(true, true)).toBe(false);
  });

  it('never asks when fingerprint unlock is off', () => {
    expect(needsBiometricUnlock(false, false)).toBe(false);
    expect(needsBiometricUnlock(false, true)).toBe(false);
  });
});

describe('isUnlockExpired — the 4 hour window', () => {
  const t0 = 1_000_000;
  it('stays unlocked when the app is switched away and back inside the window', () => {
    expect(isUnlockExpired(t0, t0 + 60_000)).toBe(false);
    expect(isUnlockExpired(t0, t0 + UNLOCK_WINDOW_MS - 1)).toBe(false);
  });
  it('locks again once 4 hours have passed', () => {
    expect(UNLOCK_WINDOW_MS).toBe(4 * 60 * 60 * 1000);
    expect(isUnlockExpired(t0, t0 + UNLOCK_WINDOW_MS)).toBe(true);
  });
  it('locks when there has been no unlock at all', () => {
    expect(isUnlockExpired(null, t0)).toBe(true);
  });
});
