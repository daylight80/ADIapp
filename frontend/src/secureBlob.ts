import * as SecureStore from 'expo-secure-store';
import Aes from 'react-native-aes-crypto';

/**
 * Envelope encryption for AsyncStorage blobs too large for SecureStore
 * itself (14 Sept 2026), per Grant directly. SecureStore is backed by the
 * OS's hardware keystore (Android Keystore / iOS Keychain), which is
 * exactly why it caps each value at ~2KB — it's built for small secrets
 * like tokens, not bulk data. Recorded GPS routes (routeRecorder.ts) and
 * the offline sync queue (offlineSync.ts) can both genuinely exceed that
 * over a real lesson, so they can't move into SecureStore directly no
 * matter how sensitive their contents are.
 *
 * Instead: generate one random AES-256 key, store *that* (tiny) in
 * SecureStore — so it inherits the hardware-backed protection — and use
 * it to encrypt the actual bulk JSON blob before it ever touches
 * AsyncStorage. AsyncStorage only ever sees ciphertext.
 *
 * Native AES (react-native-aes-crypto), not a pure-JS implementation —
 * per Grant's explicit choice, trading a fresh EAS build (new native
 * dependency) for hardware-accelerated encryption rather than a
 * pure-JS-only library that needs no rebuild.
 */

const KEY_STORE_NAME = 'adipro_blob_encryption_key_v1';
const ALGORITHM = 'aes-256-cbc';
// Every blob this module writes starts with this, so a caller can tell
// "this is one of ours" from "this is legacy plaintext JSON written by an
// older version of the app, before this change existed" without needing
// decryption to fail first — see isEncryptedBlob() below and its use at
// each call site for the one-time transparent migration this enables.
const ENC_PREFIX = 'ADIPRO_ENC_V1:';

let cachedKey: string | null = null;

// Test-only — mirrors offlineSync.ts's __resetCacheForTests. Without this,
// the in-memory cache below would keep returning the first test's key for
// every later test in the same file, regardless of SecureStore itself
// being cleared between tests.
export function __resetCacheForTests() {
  cachedKey = null;
}

async function getOrCreateKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  let key = await SecureStore.getItemAsync(KEY_STORE_NAME);
  if (!key) {
    // Aes.randomKey() is the library's own CSPRNG, hex-encoded to exactly
    // the byte length asked for — deliberately used for the IV below too,
    // rather than mixing in a second random-bytes source (e.g.
    // expo-crypto), so both are guaranteed to produce a format this same
    // library's encrypt/decrypt calls actually expect.
    key = await Aes.randomKey(32); // 256-bit key
    await SecureStore.setItemAsync(KEY_STORE_NAME, key);
  }
  cachedKey = key;
  return key;
}

/** True for a value this module produced; false for anything else,
 * including legacy plaintext JSON from before this module existed. */
export function isEncryptedBlob(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/** Encrypts an arbitrary-length string (e.g. JSON.stringify(...) output)
 * for storage in AsyncStorage. The IV isn't secret — AES-CBC just needs a
 * fresh one per encryption to be secure — so it's stored right alongside
 * the ciphertext; only the key itself lives in SecureStore. */
export async function encryptBlob(plainText: string): Promise<string> {
  const key = await getOrCreateKey();
  const iv = await Aes.randomKey(16);
  const cipherText = await Aes.encrypt(plainText, key, iv, ALGORITHM);
  return `${ENC_PREFIX}${iv}:${cipherText}`;
}

/** Reverses encryptBlob(). Throws if payload isn't in that exact format —
 * callers should check isEncryptedBlob() first for legacy plaintext data
 * rather than relying on this throwing (see each call site's read path). */
export async function decryptBlob(payload: string): Promise<string> {
  if (!isEncryptedBlob(payload)) {
    throw new Error('decryptBlob: payload is not in the expected encrypted format');
  }
  const key = await getOrCreateKey();
  const rest = payload.slice(ENC_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep === -1) {
    throw new Error('decryptBlob: malformed payload, missing iv separator');
  }
  const iv = rest.slice(0, sep);
  const cipherText = rest.slice(sep + 1);
  return await Aes.decrypt(cipherText, key, iv, ALGORITHM);
}
