import { needsBiometricUnlock } from '../biometricGate';

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
