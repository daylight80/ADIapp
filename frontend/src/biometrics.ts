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

// Timeout wrapper (20 Sept 2026) — found while diagnosing a reproducible
// blank-spinner hang on cold launch (logcat showed the app's own JS
// completing everything up to and including auth session restore, then
// total silence — no crash, no further log lines at all). The screen
// recording that caught it never showed the "ADI Pro is locked / Waiting
// for fingerprint…" text at any point, which _layout.tsx's AuthGate sets
// synchronously as soon as isBiometricEnabled() resolves true — before
// authenticateWithBiometrics() (the actual native OS prompt) is even
// called. That text never appearing points at isBiometricEnabled()'s own
// SecureStore read as the more likely hang site here specifically — this
// runs during the exact same cold-launch window as the auth session's
// own SecureStore read elsewhere, and concurrent native Keystore access
// right as the OS is still spinning up is a plausible contention point.
// authenticateWithBiometrics() gets the same treatment regardless, since
// a native OS dialog neither of us can see or interact with in a
// recording (Android deliberately excludes secure system dialogs like
// this from screen capture) hanging would be indistinguishable from the
// outside, and Grant's own stated design ("fall back to the password
// screen, not stuck retrying with no way out") already rules out either
// one being allowed to hang forever with no escape.
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

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
  // 5s is generous for a local SecureStore read with no OS UI involved —
  // this one isn't the suspected culprit, but costs nothing to guard too.
  return withTimeout(
    (async () => {
      try {
        const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
        return value === 'true';
      } catch {
        return false;
      }
    })(),
    5000,
    false,
  );
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  // 20s: long enough that a real person actually moving their finger to
  // the sensor, or a slow face-unlock read, isn't cut off mid-attempt —
  // short enough that "the OS never called back" resolves to the
  // password-screen fallback in well under the ~13-15s Grant actually
  // waited before giving up and force-closing the app in the recording
  // that surfaced this.
  return withTimeout(
    (async () => {
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
    })(),
    20000,
    false,
  );
}
