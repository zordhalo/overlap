import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same DNS-mocking approach as url-guard.test.ts: `fetchIcsIntervals` calls
// `assertFetchableUrl`, which does a real DNS lookup we must not depend on
// in CI. Mocking here (rather than mocking url-guard itself) exercises the
// real SSRF guard end to end, which is the point of this module.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { fetchIcsIntervals } from './fetch';

const mockLookup = vi.mocked(lookup);

function mockPublicDns(): void {
  mockLookup.mockImplementation(
    (() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])) as unknown as typeof lookup,
  );
}

function mockPrivateDns(): void {
  mockLookup.mockImplementation(
    (() => Promise.resolve([{ address: '10.0.0.5', family: 4 }])) as unknown as typeof lookup,
  );
}

const VALID_ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART:20260320T140000Z',
  'DTEND:20260320T150000Z',
  'SUMMARY:Test',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const WINDOW = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2027, 0, 1) };

describe('fetchIcsIntervals', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockLookup.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('runs the SSRF guard before fetching and throws for a private-address host', async () => {
    mockPrivateDns();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      fetchIcsIntervals('http://internal-host/cal.ics', { ...WINDOW, signal: new AbortController().signal }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and parses a valid public URL', async () => {
    mockPublicDns();
    global.fetch = vi.fn().mockResolvedValue(
      new Response(VALID_ICS, { status: 200 }),
    ) as unknown as typeof fetch;

    const intervals = await fetchIcsIntervals('https://calendar.example.com/secret.ics', {
      ...WINDOW,
      signal: new AbortController().signal,
    });
    expect(intervals).toEqual([{ start: Date.UTC(2026, 2, 20, 14, 0, 0), end: Date.UTC(2026, 2, 20, 15, 0, 0) }]);
  });

  it('throws on a non-2xx response rather than returning []', async () => {
    mockPublicDns();
    global.fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 })) as unknown as typeof fetch;

    await expect(
      fetchIcsIntervals('https://calendar.example.com/gone.ics', { ...WINDOW, signal: new AbortController().signal }),
    ).rejects.toThrow();
  });

  it('throws on a network error rather than returning []', async () => {
    mockPublicDns();
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    await expect(
      fetchIcsIntervals('https://calendar.example.com/cal.ics', { ...WINDOW, signal: new AbortController().signal }),
    ).rejects.toThrow('network down');
  });

  it('throws when the response body exceeds the size cap, without buffering it all', async () => {
    mockPublicDns();
    // ~6MB of filler, over the 5MB cap.
    const huge = 'A'.repeat(6 * 1024 * 1024);
    global.fetch = vi.fn().mockResolvedValue(new Response(huge, { status: 200 })) as unknown as typeof fetch;

    await expect(
      fetchIcsIntervals('https://calendar.example.com/huge.ics', { ...WINDOW, signal: new AbortController().signal }),
    ).rejects.toThrow(/exceeds/);
  });

  it('returns [] (not a throw) when the body is valid but the calendar has no matching events', async () => {
    mockPublicDns();
    global.fetch = vi.fn().mockResolvedValue(new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR', { status: 200 })) as unknown as typeof fetch;

    const intervals = await fetchIcsIntervals('https://calendar.example.com/empty.ics', {
      ...WINDOW,
      signal: new AbortController().signal,
    });
    expect(intervals).toEqual([]);
  });

  it('propagates an AbortSignal timeout as a throw', async () => {
    mockPublicDns();
    const controller = new AbortController();
    global.fetch = vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        // Guard against the signal already having fired by the time fetch is
        // called (assertFetchableUrl's DNS lookup is itself async, so an
        // abort issued "immediately" by the test can otherwise race ahead of
        // this listener being attached).
        if (init.signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;

    const promise = fetchIcsIntervals('https://calendar.example.com/slow.ics', {
      ...WINDOW,
      signal: controller.signal,
    });
    // Abort on the next tick so assertFetchableUrl's (mocked, but still
    // async) DNS lookup has a chance to resolve and reach the fetch call.
    queueMicrotask(() => controller.abort());
    await expect(promise).rejects.toThrow();
  });
});

describe('redirect handling', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('re-validates the guard on every redirect hop, not just the first URL', async () => {
    // The exploit this exists to stop: an innocuous public URL that answers
    // 302 to the cloud metadata address. `fetch` follows redirects on its own
    // by default, so a guard that only checks the original URL never sees the
    // real destination — no DNS rebinding needed, just one redirect.
    mockLookup.mockImplementation(((hostname: string) =>
      Promise.resolve(
        hostname === '169.254.169.254'
          ? [{ address: '169.254.169.254', family: 4 }]
          : [{ address: '93.184.216.34', family: 4 }],
      )) as unknown as typeof lookup);

    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(
      fetchIcsIntervals('https://calendar.example.com/c.ics', { ...WINDOW, signal: AbortSignal.timeout(5_000) }),
    ).rejects.toThrow();

    // Stopped AT the redirect rather than following it: exactly one request,
    // and it never reached the metadata address.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after a bounded number of redirects', async () => {
    mockPublicDns();
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/next' },
        }),
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(fetchIcsIntervals('https://example.com/a.ics', { ...WINDOW, signal: AbortSignal.timeout(5_000) })).rejects.toThrow(
      /redirect/i,
    );
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
