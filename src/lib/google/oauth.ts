/**
 * Google OAuth, scoped as narrowly as each feature allows.
 *
 * Connecting a calendar asks for exactly one scope: `calendar.freebusy`. That
 * endpoint returns busy intervals and nothing else — no titles, no attendees,
 * no locations — which means the privacy promise in the README ("Overlap
 * records *that* you are busy, never *what*") is enforced by Google's API
 * surface rather than by our own discipline in not reading fields we were
 * handed.
 *
 * Writing the agreed meeting into someone's calendar needs a second scope,
 * and it is requested separately, only when that person first clicks "Add to
 * Google Calendar" (incremental authorisation). Two reasons it is not bundled
 * into the connect step:
 *
 *  - A write scope is a much larger ask than availability. Someone who only
 *    wants their busy time counted should never be shown it.
 *  - Event scopes are classed as sensitive by Google. Until the app passes
 *    verification, requesting one shows an "unverified app" interstitial, and
 *    keeping it off the connect path keeps that screen off the path everyone
 *    takes.
 *
 * The scope is `calendar.events.owned` rather than `calendar.events`: it can
 * only touch calendars the person owns, never ones shared with them. Overlap
 * uses it to insert (or re-confirm) one event and never lists or reads events.
 *
 * The whole module is inert unless GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
 * are set; `isGoogleConfigured()` gates every entry point so a deployment
 * without credentials simply never offers the button.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';

/** Write access to the person's own calendars, for "Add to Google Calendar". */
export const GOOGLE_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Google calls must never hang a page render. */
const TOKEN_TIMEOUT_MS = 8_000;

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
  }
  return { clientId, clientSecret };
}

/**
 * The redirect URI, which must match an entry in the Cloud Console exactly —
 * including scheme, host, port and path. Derived from the request's own origin
 * so preview deployments work without reconfiguring anything, with an explicit
 * override for a custom domain.
 */
export function redirectUri(origin: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || origin;
  return `${base.replace(/\/$/, '')}/api/google/callback`;
}

/**
 * What the callback should do once Google hands the user back. `add` is set
 * when the grant was asked for in order to put one meeting in the calendar,
 * so the event lands in the same click instead of after a second one.
 */
export type OAuthState = {
  slug: string;
  memberId: string;
  nonce: string;
  add?: { start: number; end: number };
};

/**
 * `state` carries which member is connecting, signed so the callback cannot be
 * tricked into attaching someone else's Google account to a member of our
 * choosing. It doubles as the CSRF token OAuth requires.
 */
export function signState(payload: OAuthState): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set.');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyState(state: string): OAuthState | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const separator = state.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = state.slice(0, separator);
  const mac = state.slice(separator + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');

  // Compare as fixed-length buffers; timingSafeEqual throws on a length
  // mismatch, which would itself leak a bit of information via the exception.
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.memberId !== 'string' || typeof p.nonce !== 'string') {
      return null;
    }
    const result: OAuthState = { slug: p.slug, memberId: p.memberId, nonce: p.nonce };
    if (p.add !== undefined) {
      const add = p.add as { start?: unknown; end?: unknown } | null;
      if (
        typeof add !== 'object' ||
        add === null ||
        !Number.isInteger(add.start) ||
        !Number.isInteger(add.end)
      ) {
        return null;
      }
      result.add = { start: add.start as number, end: add.end as number };
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * `scopes` defaults to the connect grant. Passing more asks for them on top of
 * whatever was granted before (`include_granted_scopes`), so the resulting
 * refresh token covers both and replaces the stored one without losing
 * availability sync.
 */
export function buildAuthUrl(
  origin: string,
  state: string,
  scopes: readonly string[] = [GOOGLE_SCOPE],
): string {
  const { clientId } = credentials();
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri(origin));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  // `offline` is what returns a refresh token at all, and `consent` forces the
  // consent screen every time. Without the latter, a user who has authorised
  // before gets no new refresh token, so reconnecting after a revoke silently
  // yields nothing to store.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  /** Space-separated. What the user actually approved, which with granular
   *  consent can be less than what was asked for. */
  scope?: string;
};

function parseScopes(scope: string | undefined): string[] {
  return scope ? scope.split(/\s+/).filter(Boolean) : [];
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!response.ok) {
    // The body often names the real cause (redirect_uri_mismatch,
    // invalid_client), and losing it turns a five-minute console fix into an
    // afternoon. It contains no user data — only our own misconfiguration.
    const detail = await response.text().catch(() => '');
    throw new Error(`Google token request failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as TokenResponse;
}

export async function exchangeCode(
  code: string,
  origin: string,
): Promise<{ refreshToken: string | null; accessToken: string; scopes: string[] }> {
  const { clientId, clientSecret } = credentials();
  const json = await postToken(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(origin),
      grant_type: 'authorization_code',
    }),
  );
  if (!json.access_token) throw new Error('Google returned no access token.');
  return {
    refreshToken: json.refresh_token ?? null,
    accessToken: json.access_token,
    scopes: parseScopes(json.scope),
  };
}

export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  return (await accessTokenWithScopes(refreshToken)).accessToken;
}

/**
 * An access token plus the scopes the grant behind it carries. Google reports
 * them on every refresh, which is how "may Overlap write to this calendar?" is
 * answered without storing a second copy of the grant that could drift.
 */
export async function accessTokenWithScopes(
  refreshToken: string,
): Promise<{ accessToken: string; scopes: string[] }> {
  const { clientId, clientSecret } = credentials();
  const json = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  );
  if (!json.access_token) throw new Error('Google returned no access token on refresh.');
  return { accessToken: json.access_token, scopes: parseScopes(json.scope) };
}
