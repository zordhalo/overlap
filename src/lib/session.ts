/**
 * Member identity, with no accounts. A signed HTTP-only cookie holds a
 * `member_id`, so someone who joined a circle can come back later and edit
 * their own availability without a password — the cookie is the only proof
 * of "this is you."
 *
 * Scoped per circle (`overlap_member_<slug>`) rather than one global cookie:
 * the product is co-founders reusing a standing circle weekly, but nothing
 * stops one person from being in more than one circle (family + work), and
 * a single shared cookie would mean joining a second circle silently signs
 * you out of the first. Cookie `path` is also scoped to `/c/<slug>` so it is
 * never sent to unrelated routes.
 *
 * Signed with HMAC-SHA256 over `member_id`, not encrypted: `member_id` is
 * already a random UUID no one could otherwise guess, and encryption buys
 * nothing beyond a MAC once the value itself isn't secret. What must hold is
 * that a client cannot mint or alter the cookie without `SESSION_SECRET`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/** ~1 year. There is no login to expire from, so the cookie's job is to
 *  outlive an ordinary browsing session, not to force periodic re-auth. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function cookieName(circleSlug: string): string {
  return `overlap_member_${circleSlug}`;
}

function loadSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not set. Refusing to sign or verify session cookies.');
  }
  return secret;
}

/** The slug is folded into the signed payload, not just the cookie name, so
 *  a cookie minted for one circle can't be replayed as valid for another —
 *  the cookie name alone is client-controlled framing, not part of the MAC. */
function sign(circleSlug: string, memberId: string): string {
  return createHmac('sha256', loadSecret()).update(`${circleSlug}:${memberId}`).digest('base64url');
}

/**
 * Constant-time comparison of two signatures. `timingSafeEqual` throws if
 * the buffers differ in length, which a naive attacker-controlled signature
 * easily triggers — treated as "not equal," not as a crash.
 */
function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function encodeCookie(circleSlug: string, memberId: string): string {
  return `${memberId}.${sign(circleSlug, memberId)}`;
}

/**
 * Parses and verifies a raw cookie value, returning the `member_id` or
 * `null`. Never throws — a tampered, malformed, or absent cookie is an
 * ordinary "you're not signed in" state, not an error a render should fail
 * on.
 */
function decodeCookie(circleSlug: string, raw: string | undefined): string | null {
  if (!raw) return null;
  const separatorIndex = raw.lastIndexOf('.');
  if (separatorIndex <= 0) return null;
  const memberId = raw.slice(0, separatorIndex);
  const signature = raw.slice(separatorIndex + 1);
  if (!memberId || !signature) return null;

  let expected: string;
  try {
    expected = sign(circleSlug, memberId);
  } catch {
    // SESSION_SECRET missing — a config problem, not a per-request one, but
    // still must not throw into a render.
    return null;
  }
  return signaturesMatch(signature, expected) ? memberId : null;
}

/** Reads the current visitor's `member_id` for `circleSlug`, or `null` if
 *  they have none (or the cookie is tampered/expired/missing/for a
 *  different circle). `cookies()` is async in Next 16. */
export async function getSessionMemberId(circleSlug: string): Promise<string | null> {
  const store = await cookies();
  return decodeCookie(circleSlug, store.get(cookieName(circleSlug))?.value);
}

/**
 * Sets the session cookie identifying `memberId` as the caller within
 * `circleSlug`. Must be called from a Server Action or Route Handler —
 * `cookies().set` throws outside a request that can send a response.
 */
export async function setSessionMemberId(circleSlug: string, memberId: string): Promise<void> {
  const store = await cookies();
  store.set(cookieName(circleSlug), encodeCookie(circleSlug, memberId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/c/${circleSlug}`,
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Clears the session cookie for `circleSlug`. Not currently wired to any UI
 *  (there is no "sign out" concept for a passwordless identity), but kept
 *  small and available rather than left as a TODO some caller reaches for
 *  later. */
export async function clearSessionMemberId(circleSlug: string): Promise<void> {
  const store = await cookies();
  store.delete({ name: cookieName(circleSlug), path: `/c/${circleSlug}` });
}
