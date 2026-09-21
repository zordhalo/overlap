import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { googleEventId, moveGoogleInvite, sendGoogleInvite } from './events';
import { GOOGLE_EVENTS_SCOPE, GOOGLE_SCOPE, buildAuthUrl, signState, verifyState } from './oauth';
import { googleTemplateUrl } from './template';

const INPUT = {
  circleId: '0b6f5a2e-1111-4222-8333-444455556666',
  start: Date.UTC(2026, 8, 22, 13, 15),
  end: Date.UTC(2026, 8, 22, 13, 45),
  summary: 'Co-founders',
  description: 'Scheduled with Overlap.',
  url: 'https://overlap.runs-on.dev/c/abc',
  attendees: [
    { email: 'matthew@example.com', name: 'Matthew' },
    { email: 'reeti@example.com', name: 'Reeti' },
  ],
};

const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

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
  patch?: () => Response;
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
    if (method === 'PATCH' && handlers.patch) return handlers.patch();
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

function googleEnv() {
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
}

describe('sendGoogleInvite', () => {
  googleEnv();

  it('asks for permission, without writing, when the grant is availability-only', async () => {
    const calls = mockGoogle({ token: () => json(200, { access_token: 'at', scope: GOOGLE_SCOPE }) });
    await expect(sendGoogleInvite('rt', INPUT)).resolves.toEqual({ status: 'needs-permission' });
    expect(calls).toHaveLength(1);
  });

  it('creates one event with the guests on it, and has Google mail them', async () => {
    const calls = mockGoogle({
      token: withWrite,
      insert: () => json(200, { htmlLink: 'https://calendar.google.com/event?eid=x' }),
    });
    const id = googleEventId(INPUT.circleId, INPUT.start, INPUT.end);
    await expect(sendGoogleInvite('rt', INPUT)).resolves.toEqual({
      status: 'sent',
      eventId: id,
      htmlLink: 'https://calendar.google.com/event?eid=x',
    });
    const insert = calls[1]!;
    expect(insert.url).toBe(`${EVENTS}?sendUpdates=all`);
    const body = insert.body as Record<string, unknown>;
    expect(body.id).toBe(id);
    expect(body.start).toEqual({ dateTime: '2026-09-22T13:15:00.000Z' });
    expect(body.end).toEqual({ dateTime: '2026-09-22T13:45:00.000Z' });
    expect(body.attendees).toEqual([
      { email: 'matthew@example.com', displayName: 'Matthew' },
      { email: 'reeti@example.com', displayName: 'Reeti' },
    ]);
  });

  it('overwrites an existing invite (a retry, or one deleted) instead of duplicating it', async () => {
    const calls = mockGoogle({
      token: withWrite,
      insert: () => json(409, { error: { message: 'The requested identifier already exists.' } }),
      put: () => json(200, { status: 'confirmed', htmlLink: 'restored' }),
    });
    const id = googleEventId(INPUT.circleId, INPUT.start, INPUT.end);
    await expect(sendGoogleInvite('rt', INPUT)).resolves.toEqual({
      status: 'sent',
      eventId: id,
      htmlLink: 'restored',
    });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'PUT']);
    expect(calls[2]!.url).toBe(`${EVENTS}/${id}?sendUpdates=all`);
    expect((calls[2]!.body as { status: string }).status).toBe('confirmed');
  });

  it('reports an insufficient-scope 403 as a permission problem', async () => {
    mockGoogle({
      token: withWrite,
      insert: () => json(403, { error: { message: 'Request had insufficient authentication scopes.' } }),
    });
    await expect(sendGoogleInvite('rt', INPUT)).resolves.toEqual({ status: 'needs-permission' });
  });

  it('throws on a server error rather than claiming success', async () => {
    mockGoogle({ token: withWrite, insert: () => json(503, {}) });
    await expect(sendGoogleInvite('rt', INPUT)).rejects.toThrow(/503/);
  });
});

describe('moveGoogleInvite', () => {
  googleEnv();

  it('patches the same event to the new time, notifying guests', async () => {
    const calls = mockGoogle({ token: withWrite, patch: () => json(200, { htmlLink: 'moved' }) });
    await expect(moveGoogleInvite('rt', 'evt123', INPUT)).resolves.toEqual({
      status: 'sent',
      eventId: 'evt123',
      htmlLink: 'moved',
    });
    expect(calls[1]!.url).toBe(`${EVENTS}/evt123?sendUpdates=all`);
    expect(calls[1]!.body).not.toHaveProperty('id');
  });

  it('says the event is gone when the organizer deleted it outright', async () => {
    mockGoogle({ token: withWrite, patch: () => json(404, {}) });
    await expect(moveGoogleInvite('rt', 'evt123', INPUT)).resolves.toEqual({ status: 'gone' });
  });
});

describe('OAuth state and scopes', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'test-secret');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips the slot to invite through signed state', () => {
    const state = { slug: 's', memberId: 'm', nonce: 'n', invite: { start: INPUT.start, end: INPUT.end } };
    expect(verifyState(signState(state))).toEqual(state);
  });

  it('still verifies state without an invite intent', () => {
    expect(verifyState(signState({ slug: 's', memberId: 'm', nonce: 'n' }))).toEqual({
      slug: 's',
      memberId: 'm',
      nonce: 'n',
    });
  });

  it('rejects state whose slot was tampered with', () => {
    const signed = signState({ slug: 's', memberId: 'm', nonce: 'n', invite: { start: 1, end: 2 } });
    const [body, mac] = signed.split('.');
    const forged = Buffer.from(
      JSON.stringify({ slug: 's', memberId: 'm', nonce: 'n', invite: { start: 1, end: 9 } }),
    ).toString('base64url');
    expect(verifyState(`${forged}.${mac}`)).toBeNull();
    expect(body).not.toBe(forged);
  });

  it('asks only for availability by default, and for both when inviting', () => {
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
