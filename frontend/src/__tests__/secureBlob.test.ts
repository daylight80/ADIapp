import * as SecureStore from 'expo-secure-store';
import { encryptBlob, decryptBlob, isEncryptedBlob, __resetCacheForTests } from '../secureBlob';

describe('secureBlob', () => {
  beforeEach(async () => {
    // Clears both the persisted key (SecureStore) and the in-memory cache
    // of it (__resetCacheForTests) so each test gets a genuinely fresh
    // key, rather than reusing whatever an earlier test generated.
    await SecureStore.deleteItemAsync('adipro_blob_encryption_key_v1');
    __resetCacheForTests();
  });

  it('round-trips a plain string through encrypt then decrypt', async () => {
    const original = JSON.stringify({ hello: 'world', n: 42 });
    const encrypted = await encryptBlob(original);
    expect(await decryptBlob(encrypted)).toBe(original);
  });

  it('round-trips a large payload (thousands of GPS points)', async () => {
    const points = Array.from({ length: 3000 }, (_, i) => ({ lat: 51.36 + i * 0.0001, lng: -0.19, t: i }));
    const original = JSON.stringify(points);
    const encrypted = await encryptBlob(original);
    expect(await decryptBlob(encrypted)).toBe(original);
  });

  it('marks its own output as an encrypted blob', async () => {
    const encrypted = await encryptBlob('anything');
    expect(isEncryptedBlob(encrypted)).toBe(true);
  });

  it('does not treat plain JSON (legacy, pre-encryption data) as an encrypted blob', () => {
    expect(isEncryptedBlob('{"id":"abc","points":[]}')).toBe(false);
  });

  it('throws rather than silently returning garbage when asked to decrypt non-encrypted input', async () => {
    await expect(decryptBlob('{"id":"abc"}')).rejects.toThrow();
  });

  it('uses a fresh IV each time, so encrypting the same text twice gives different ciphertext', async () => {
    const a = await encryptBlob('same input');
    const b = await encryptBlob('same input');
    expect(a).not.toBe(b);
    // Both must still decrypt back to the original despite differing.
    expect(await decryptBlob(a)).toBe('same input');
    expect(await decryptBlob(b)).toBe('same input');
  });

  it('reuses the same underlying key across separate encrypt calls (persisted, not regenerated each time)', async () => {
    await encryptBlob('first call, to create the key');
    const keyAfterFirstCall = await SecureStore.getItemAsync('adipro_blob_encryption_key_v1');
    await encryptBlob('second call');
    const keyAfterSecondCall = await SecureStore.getItemAsync('adipro_blob_encryption_key_v1');
    expect(keyAfterFirstCall).toBeTruthy();
    expect(keyAfterSecondCall).toBe(keyAfterFirstCall);
  });
});
