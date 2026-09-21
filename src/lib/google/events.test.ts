import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addGoogleEvent, googleEventId } from './events';
import { GOOGLE_EVENTS_SCOPE, GOOGLE_SCOPE, buildAuthUrl, signState, verifyState } from './oauth';
import { googleTemplateUrl } from './template';

const INPUT = {
  circleId: '0b6f5a2e-1111-4222-8333-444455556666',
  start: Date.UTC(2026, 8, 22, 13, 15),
  end: Date.UTC(2026, 8, 22, 13, 45),
  summary: 'Co-founders',
  description: 'Scheduled with Overlap.',
  url: 'https://overlap.runs-on.dev/c/abc',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Routes each fetch by URL and method, recording every call. */
function mockGoogle(handlers: {
  token: () => Response;
  insert?: () => Response;
  get?: () => Response;
  put?: () => Response;
}) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body;
    calls.push({ url, method, body });
    if (url.includes('oauth2.googleapis.com/token')) return handlers.token();
    if (method === 'POST' && handlers.insert) return handlers.insert();
    if (method === 'GET' && handlers.get) return handlers.get();
    if (method === 'PUT' && handlers.put) return handlers.put();
    throw new Error(`Unexpected ${method} ${url}`);
  }) as typeof fetch;
  return calls;
}

const withWrite = () =>
  json(200, { access_token: 'at', scope: `${GOOGLE_SCOPE} ${GOOGLE_EVENTS_SCOPE}` });

describe('googleEventId', () => {
  it('is stable for the same circle and slot, and valid base32hex', () => {
    const a = googleEventId(INPUT.circleId, INPUT.start, INPUT.end);
    expect(a).toBe(googleEventId(INPUT.circleId, INPUT.start, INPUT.end));
    expect(a).toMatch(/^[0-9a-v]{5,1024}$/);
  });

  it('differs when the time changes, so a new agreement is a new event', () => {
    expect(googleEventId(INPUT.circleId, INPUT.start, INPUT.end)).not.toBe(
      googleEventId(INPUT.circleId, INPUT.start + 900_000, INPUT.end + 900_000),
    );
  });
});

describe('addGoogleEvent', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('asks for permission, without writing, when the grant is availability-only', async () => {
    const calls = mockGoogle({ token: () => json(200, { access_token: 'at', scope: GOOGLE_SCOPE }) });
    await expect(addGoogleEvent('rt', INPUT)).resolves.toEqual({ status: 'needs-permission' });
    expect(calls).toHaveLength(1);
  });

  it('inserts one event on the primary calendar with a deterministic id', async () => {
    const calls = mockGoogle({
      token: withWrite,
      insert: () => json(200, { htmlLink: 'https://calendar.google.com/event?eid=x' }),
    });
    await expect(addGoogleEvent('rt', INPUT)).resolves.toEqual({
      status: 'added',
      htmlLink: 'https://calendar.google.com/event?eid=x',
    });
    const insert = calls[1]!;
    expect(insert.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    const body = insert.body as Record<string, unknown>;
    expect(body.id).toBe(googleEventId(INPUT.circleId, INPUT.start, INPUT.end));
    expect(body.start).toEqual({ dateTime: '2026-09-22T13:15:00.000Z' });
    expect(body.end).toEqual({ dateTime: '2026-09-22T13:45:00.000Z' });
    // Nobody is invited from here; each member writes only to their own calendar.
    expect(body).not.toHaveProperty('attendees');
  });

  it('treats an existing event as already added instead of duplicating it', async () => {
    const calls = mockGoogle({
      token: withWrite,
      insert: () => json(409, { error: { message: 'The requested identifier already exists.' } }),
      get: () => json(200, { status: 'confirmed', htmlLink: 'link' }),
    });
    await expect(addGoogleEvent('rt', INPUT)).resolves.toEqual({ status: 'already', htmlLink: 'link' });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'GET']);
  });

  it('restores an event the person had deleted', async () => {
    const calls = mockGoogle({
      token: withWrite,
      insert: () => json(409, {}),
      get: () => json(200, { status: 'cancelled' }),
      put: () => json(200, { status: 'confirmed', htmlLink: 'restored' }),
    });
    await expect(addGoogleEvent('rt', INPUT)).resolves.toEqual({ status: 'added', htmlLink: 'restored' });
    expect((calls[3]!.body as { status: string }).status).toBe('confirmed');
  });

  it('reports an insufficient-scope 403 as a permission problem', async () => {
    mockGoogle({
      token: withWrite,
      insert: () => json(403, { error: { message: 'Request had insufficient authentication scopes.' } }),
    });
    await expect(addGoogleEvent('rt', INPUT)).resolves.toEqual({ status: 'needs-permission' });
  });

  it('throws on a server error rather than claiming success', async () => {
    mockGoogle({ token: withWrite, insert: () => json(503, {}) });
    await expect(addGoogleEvent('rt', INPUT)).rejects.toThrow(/503/);
  });
});

describe('OAuth state and scopes', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'test-secret');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips the slot to add through signed state', () => {
    const state = { slug: 's', memberId: 'm', nonce: 'n', add: { start: INPUT.start, end: INPUT.end } };
    expect(verifyState(signState(state))).toEqual(state);
  });

  it('still verifies state without an add intent', () => {
    expect(verifyState(signState({ slug: 's', memberId: 'm', nonce: 'n' }))).toEqual({
      slug: 's',
      memberId: 'm',
      nonce: 'n',
    });
  });

  it('rejects state whose slot was tampered with', () => {
    const signed = signState({ slug: 's', memberId: 'm', nonce: 'n', add: { start: 1, end: 2 } });
    const [body, mac] = signed.split('.');
    const forged = Buffer.from(
      JSON.stringify({ slug: 's', memberId: 'm', nonce: 'n', add: { start: 1, end: 9 } }),
    ).toString('base64url');
    expect(verifyState(`${forged}.${mac}`)).toBeNull();
    expect(body).not.toBe(forged);
  });

  it('asks only for availability by default, and for both when adding', () => {
    const connect = new URL(buildAuthUrl('https://x.test', 'st'));
    expect(connect.searchParams.get('scope')).toBe(GOOGLE_SCOPE);
    const add = new URL(buildAuthUrl('https://x.test', 'st', [GOOGLE_SCOPE, GOOGLE_EVENTS_SCOPE]));
    expect(add.searchParams.get('scope')).toBe(`${GOOGLE_SCOPE} ${GOOGLE_EVENTS_SCOPE}`);
    expect(add.searchParams.get('include_granted_scopes')).toBe('true');
  });
});

describe('googleTemplateUrl', () => {
  it('prefills a Google Calendar event in UTC basic format', () => {
    const url = new URL(googleTemplateUrl(INPUT));
    expect(url.origin).toBe('https://calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20260922T131500Z/20260922T134500Z');
    expect(url.searchParams.get('text')).toBe('Co-founders');
  });
});
