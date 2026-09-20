import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

import { isBiometricEnabled, authenticateWithBiometrics } from '../biometrics';

const mockedAuthenticateAsync = LocalAuthentication.authenticateAsync as jest.Mock;

describe('biometrics', () => {
  beforeEach(async () => {
    jest.useRealTimers();
    await SecureStore.deleteItemAsync('biometric_unlock_enabled');
    mockedAuthenticateAsync.mockReset();
  });

  describe('isBiometricEnabled', () => {
    it('returns false when never set', async () => {
      expect(await isBiometricEnabled()).toBe(false);
    });

    it('returns true once enabled, false once disabled', async () => {
      await SecureStore.setItemAsync('biometric_unlock_enabled', 'true');
      expect(await isBiometricEnabled()).toBe(true);
      await SecureStore.setItemAsync('biometric_unlock_enabled', 'false');
      expect(await isBiometricEnabled()).toBe(false);
    });

    it('resolves to false (not hangs forever) if the underlying read never settles', async () => {
      jest.useFakeTimers();
      // Simulates the exact failure mode found in production: the native
      // call neither resolves nor rejects, ever.
      jest.spyOn(SecureStore, 'getItemAsync').mockReturnValue(new Promise(() => {}));

      let resolved: boolean | undefined;
      isBiometricEnabled().then((v) => { resolved = v; });

      // Still pending well before the timeout — proves this isn't just
      // coincidentally fast, the timeout is actually what's firing below.
      await jest.advanceTimersByTimeAsync(4999);
      expect(resolved).toBeUndefined();

      await jest.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(false);

      jest.useRealTimers();
    });
  });

  describe('authenticateWithBiometrics', () => {
    it('returns true on a successful prompt', async () => {
      mockedAuthenticateAsync.mockResolvedValue({ success: true });
      expect(await authenticateWithBiometrics()).toBe(true);
    });

    it('returns false when the prompt fails or is cancelled', async () => {
      mockedAuthenticateAsync.mockResolvedValue({ success: false });
      expect(await authenticateWithBiometrics()).toBe(false);
    });

    it('returns false (not hangs forever) if the OS never calls back at all', async () => {
      jest.useFakeTimers();
      // The reproduced bug: a native OS-level dialog that never resolves
      // or rejects, indistinguishable from the outside (and, per the
      // investigation notes above the timeout helper, invisible to a
      // screen recording) from a genuinely hung promise.
      mockedAuthenticateAsync.mockReturnValue(new Promise(() => {}));

      let resolved: boolean | undefined;
      authenticateWithBiometrics().then((v) => { resolved = v; });

      await jest.advanceTimersByTimeAsync(19999);
      expect(resolved).toBeUndefined();

      await jest.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(false);

      jest.useRealTimers();
    });
  });
});
