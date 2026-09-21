import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { SIGNIN_TOKEN_TTL_MS, signSigninToken, verifySigninToken } from './signin-token';

const SLUG = 'vpRNT2retfhT9dRvyEPsc';
const MEMBER = '252dde05-e5ae-4362-a060-211167cd1a38';
const HASH = 'stored-email-hash';
const NOW = 1_800_000_000_000;

const hashes = (map: Record<string, string | null>) => async (id: string) => map[id] ?? null;

describe('signin-token', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'test-secret-that-is-long-enough');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const token = () => signSigninToken({ slug: SLUG, memberId: MEMBER, emailHash: HASH }, NOW);

  it('round-trips to the member it names', async () => {
    expect(
      await verifySigninToken(token(), { slug: SLUG, currentEmailHash: hashes({ [MEMBER]: HASH }) }, NOW),
    ).toEqual({ memberId: MEMBER });
  });

  it('expires', async () => {
    const later = NOW + SIGNIN_TOKEN_TTL_MS + 1;
    expect(
      await verifySigninToken(token(), { slug: SLUG, currentEmailHash: hashes({ [MEMBER]: HASH }) }, later),
    ).toBeNull();
  });

  it('dies when the member changes or removes their email', async () => {
    expect(
      await verifySigninToken(token(), { slug: SLUG, currentEmailHash: hashes({ [MEMBER]: 'new-hash' }) }, NOW),
    ).toBeNull();
    expect(
      await verifySigninToken(token(), { slug: SLUG, currentEmailHash: hashes({ [MEMBER]: null }) }, NOW),
    ).toBeNull();
  });

  it('is bound to its circle', async () => {
    expect(
      await verifySigninToken(token(), { slug: 'another-circle', currentEmailHash: hashes({ [MEMBER]: HASH }) }, NOW),
    ).toBeNull();
  });

  it('rejects tampering and garbage without throwing', async () => {
    const t = token();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), m: 'someone-else' }),
    ).toString('base64url');
    const opts = { slug: SLUG, currentEmailHash: hashes({ [MEMBER]: HASH, 'someone-else': HASH }) };
    expect(await verifySigninToken(`${forged}.${sig}`, opts, NOW)).toBeNull();
    for (const junk of ['', '.', 'abc', `${body}.`, `${body}.x`, t.slice(0, -3)]) {
      expect(await verifySigninToken(junk, opts, NOW)).toBeNull();
    }
  });

  it('does not accept a value signed with the same secret for another purpose', async () => {
    // Shaped like the OAuth state: same secret, no domain prefix.
    const body = Buffer.from(JSON.stringify({ s: SLUG, m: MEMBER, h: 'x', e: NOW + 1000 })).toString('base64url');
    const sig = createHmac('sha256', 'test-secret-that-is-long-enough').update(body).digest('base64url');
    expect(
      await verifySigninToken(`${body}.${sig}`, { slug: SLUG, currentEmailHash: hashes({ [MEMBER]: HASH }) }, NOW),
    ).toBeNull();
  });
});
