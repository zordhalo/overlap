/**
 * Sign-in links, for getting back to being *yourself* in a circle from a
 * browser that has no session cookie.
 *
 * The circle link alone only restores the circle. Identity lives in a
 * per-browser cookie (see `session.ts`), so a new device, a cleared browser or
 * a recovery email used to land people on "Add yourself", and following that
 * created a second copy of them they could not remove.
 *
 * A token names one member of one circle and is only ever mailed to that
 * member's own recovery address, so holding it proves inbox access, which is
 * the same thing recovery already trusted. It is stateless (HMAC, no table),
 * which makes it replayable until it expires. Two things bound that:
 *
 * - **Expiry.** `SIGNIN_TOKEN_TTL_MS`, long enough to open tomorrow morning's
 *   email, short enough that an old forwarded message stops working.
 * - **Email binding.** The token carries a fingerprint of the member's email
 *   hash at send time, and the route re-checks it. Changing or removing the
 *   address kills every link already sent.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Folded into the MAC so no other value signed with SESSION_SECRET can pass
 * as a sign-in token. The OAuth `state` in `lib/google/oauth.ts` is also a
 * signed `{ slug, memberId, ... }`: without this prefix, a state token from
 * one's own OAuth redirect would be a valid sign-in token.
 */
const DOMAIN = 'overlap-signin-v1:';

export type SigninClaims = { slug: string; memberId: string; emailHash: string };

type Payload = { s: string; m: string; h: string; e: number };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error('SESSION_SECRET is not set.');
  return value;
}

function mac(body: string): string {
  return createHmac('sha256', secret()).update(DOMAIN + body).digest('base64url');
}

/** A short, non-reversible fingerprint. The full hash need not ride in a URL. */
function fingerprint(emailHash: string): string {
  return createHmac('sha256', secret()).update(`signin-email:${emailHash}`).digest('base64url').slice(0, 16);
}

export function signSigninToken(claims: SigninClaims, now: number = Date.now()): string {
  const payload: Payload = {
    s: claims.slug,
    m: claims.memberId,
    h: fingerprint(claims.emailHash),
    e: now + SIGNIN_TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(body)}`;
}

/**
 * Returns the member the token names, or null. Never throws: a forged,
 * expired, truncated or mangled-by-a-mail-client token is an ordinary "this
 * link no longer works", not an error.
 *
 * `currentEmailHash` is the member's hash *now*, read by the caller from the
 * database, so the email binding is checked here rather than trusted to every
 * caller to remember.
 */
export async function verifySigninToken(
  token: string,
  expected: { slug: string; currentEmailHash: (memberId: string) => Promise<string | null> },
  now: number = Date.now(),
): Promise<{ memberId: string } | null> {
  try {
    const separator = token.lastIndexOf('.');
    if (separator <= 0) return null;
    const body = token.slice(0, separator);
    const given = Buffer.from(token.slice(separator + 1));
    const want = Buffer.from(mac(body));
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<Payload>;
    if (typeof p.s !== 'string' || typeof p.m !== 'string' || typeof p.h !== 'string') return null;
    if (typeof p.e !== 'number' || p.e <= now) return null;
    if (p.s !== expected.slug) return null;

    // Looked up only after the MAC, expiry and circle all check out, so a
    // forged token never costs a database read.
    const hash = await expected.currentEmailHash(p.m);
    if (!hash || fingerprint(hash) !== p.h) return null;

    return { memberId: p.m };
  } catch {
    return null;
  }
}
