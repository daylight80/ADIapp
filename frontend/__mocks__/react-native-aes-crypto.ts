// Manual mock (14 Sept 2026) — react-native-aes-crypto is a native module
// with no JS implementation to fall back on, so Jest (running in Node, not
// on a device) can't call the real thing at all. Auto-discovered by Jest
// for any test that imports the real package, with no jest.mock() call
// needed anywhere, since this file sits at <rootDir>/__mocks__/ matching
// the package name exactly — Jest's standard convention for node_modules
// packages.
//
// Backed by Node's own built-in crypto module rather than a bare no-op
// stub, so tests exercise a genuine AES-256-CBC round trip (encrypt then
// decrypt actually has to produce the original text back) instead of only
// confirming the code path doesn't crash. Key/iv are treated as hex
// strings on both sides — matching the real library's own convention,
// which is why secureBlob.ts feeds Aes.randomKey()'s hex output straight
// into Aes.encrypt()/decrypt() without any re-encoding step.
import * as crypto from 'crypto';

function randomKey(length: number): Promise<string> {
  return Promise.resolve(crypto.randomBytes(length).toString('hex'));
}

function encrypt(text: string, key: string, iv: string, _algorithm: string): Promise<string> {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Promise.resolve(encrypted.toString('base64'));
}

function decrypt(cipherText: string, key: string, iv: string, _algorithm: string): Promise<string> {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherText, 'base64')), decipher.final()]);
  return Promise.resolve(decrypted.toString('utf8'));
}

export default { randomKey, encrypt, decrypt };
