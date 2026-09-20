/**
 * AES-256-GCM helpers for at-rest secrets, chiefly a member's iCal URL.
 *
 * That URL is a credential: whoever holds it can read the owner's whole
 * calendar. So it is never stored, logged, or transmitted in plaintext once
 * it reaches the server, and a tampered ciphertext must throw rather than
 * silently decrypt to garbage — GCM's auth tag is what makes that possible,
 * and skipping it would turn this into plain CTR-mode encryption.
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
/** GCM's recommended IV length. A fixed or reused IV breaks GCM catastrophically
 *  (it lets an attacker recover the authentication key), so every encryption
 *  call draws a fresh one from the OS CSPRNG. */
const IV_BYTES = 12;

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Refusing to encrypt or decrypt without it — ' +
        'there is no plaintext fallback.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (base64 of a 256-bit key), got ${key.length}.`,
    );
  }
  return key;
}

/**
 * Encrypts `plaintext`, returning `iv:authTag:ciphertext`, each segment
 * base64. The colon-joined format keeps the three parts self-describing
 * without a length-prefixed binary blob.
 */
export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

/**
 * Decrypts a value produced by `encrypt`. Throws if the payload is malformed
 * or the auth tag does not verify — a tampered or corrupted ciphertext must
 * never come back as plausible-looking garbage.
 */
export function decrypt(payload: string): string {
  const key = loadKey();
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload: expected "iv:authTag:ciphertext".');
  }
  const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  if (iv.length !== IV_BYTES) {
    throw new Error(`Malformed encrypted payload: IV must be ${IV_BYTES} bytes.`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  // Throws (bad decrypt) if the ciphertext or tag was tampered with.
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
