// Manual mock (14 Sept 2026) — found while adding secureBlob.ts's tests.
// expo-secure-store delegates every call to a native module
// (ExpoSecureStore), and unlike @react-native-async-storage/async-storage
// (which ships its own official jest mock, wired up in jest.config.js),
// jest-expo's preset has no mock for this one — every getItemAsync/
// setItemAsync call was silently resolving to undefined and persisting
// nothing, which would have made secureBlob.test.ts's "the key survives
// across calls" test pass for the wrong reason (the module's own
// in-memory cache, not real persistence) had it not asserted on
// SecureStore directly. In-memory Map here, so tests instead exercise the
// same read-your-own-write behavior the real Keychain/Keystore gives on
// an actual device.
const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? store.get(key)! : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}
