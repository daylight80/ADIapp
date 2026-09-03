import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Biometric app-unlock (3 Sept 2026), per Grant directly. Opt-in, once a
 * user account is already set up — not a new Supabase auth method, since
 * Supabase itself has no concept of a fingerprint. This sits entirely on
 * top of the app's existing, already-working session persistence
 * (AuthContext already restores a valid session via SecureStore on every
 * launch, with no biometric gate at all before this): a biometric prompt
 * simply has to succeed before the already-restored session is allowed to
 * be used, each time the app launches.
 *
 * If biometric fails or is cancelled, per Grant's direct choice: sign out
 * entirely and fall back to the normal email/password screen, rather than
 * silently letting the user through on their still-technically-valid
 * session, or getting stuck retrying with no way out. Waving them through
 * on failure would defeat the point of the feature.
 */

const BIOMETRIC_ENABLED_KEY = 'biometric_unlock_enabled';

export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return isEnrolled;
  } catch {
    return false;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    return value === 'true';
  } catch {
    return false;
  }
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock ADI Pro',
      cancelLabel: 'Use password instead',
      // Deliberately true (3 Sept 2026) — Grant's chosen fallback is the
      // app's own email/password screen specifically, not the device's
      // own OS-level PIN. With this false (the default), a failed
      // fingerprint could offer "use device PIN" instead, which the OS
      // would report back as success=true, letting someone in who only
      // knows the phone's unlock code rather than this account's actual
      // credentials.
      disableDeviceFallback: true,
    });
    return result.success;
  } catch {
    return false;
  }
}
