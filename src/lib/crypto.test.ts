import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt, decrypt } from './crypto';

// A known, fixed 32-byte key, base64-encoded. This suite must not depend on
// .env.local or any other developer/deploy-specific setup — vitest does not
// load it, and a test that only passes when a gitignored file happens to
// exist is not a test. `vi.stubEnv` scopes the value to this file and
// `unstubAllEnvs` restores whatever vitest is truly running with afterward.
const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

describe('crypto', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', VALID_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a plaintext through encrypt/decrypt', () => {
    const plaintext = 'https://calendar.google.com/calendar/ical/secret-token/basic.ics';
    const payload = encrypt(plaintext);
    expect(decrypt(payload)).toBe(plaintext);
  });

  it('produces a different ciphertext each time, proving the IV is random', () => {
    const plaintext = 'https://outlook.office365.com/owa/calendar/secret/calendar.ics';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    // But both still decrypt to the same plaintext.
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('throws rather than returning garbage when the ciphertext is tampered with', () => {
    const payload = encrypt('https://example.com/secret.ics');
    const parts = payload.split(':');
    const ciphertext = Buffer.from(parts[2] as string, 'base64');
    // Flip a bit in the ciphertext body.
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    const tampered = [parts[0], parts[1], ciphertext.toString('base64')].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws rather than returning garbage when the auth tag is tampered with', () => {
    const payload = encrypt('https://example.com/secret.ics');
    const parts = payload.split(':');
    const authTag = Buffer.from(parts[1] as string, 'base64');
    authTag[0] = (authTag[0] ?? 0) ^ 0xff;
    const tampered = [parts[0], authTag.toString('base64'), parts[2]].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws on a malformed payload instead of decrypting silently', () => {
    expect(() => decrypt('not-a-valid-payload')).toThrow();
  });

  it('throws loudly if ENCRYPTION_KEY does not decode to 32 bytes', () => {
    vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(16, 7).toString('base64')); // AES-128 length, not 256
    expect(() => encrypt('https://example.com/secret.ics')).toThrow(/32 bytes/);
  });

  it('throws loudly if ENCRYPTION_KEY is unset, rather than falling back to plaintext', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(() => encrypt('https://example.com/secret.ics')).toThrow(/ENCRYPTION_KEY is not set/);
  });
});
