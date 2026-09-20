import { describe, it, expect, vi, beforeEach } from 'vitest';

// DNS is mocked so these tests are deterministic and offline — the "public
// URL" case in particular must not depend on real network access in CI.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { assertFetchableUrl } from './url-guard';

const mockLookup = vi.mocked(lookup);

/** `dns.lookup`'s overloads make the `{ all: true }` shape awkward for the
 *  mock's inferred return type; this pins it to the array form we actually
 *  use so call sites below stay plain object literals. */
function mockResolves(addresses: { address: string; family: number }[]): void {
  mockLookup.mockImplementation(
    (() => Promise.resolve(addresses)) as unknown as typeof lookup,
  );
}

describe('assertFetchableUrl', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it('rejects the cloud metadata address', async () => {
    mockResolves([{ address: '169.254.169.254', family: 4 }]);
    await expect(assertFetchableUrl('http://metadata.internal/latest/meta-data')).rejects.toThrow();
  });

  it('rejects localhost', async () => {
    mockResolves([{ address: '127.0.0.1', family: 4 }]);
    await expect(assertFetchableUrl('http://localhost/cal.ics')).rejects.toThrow();
  });

  it('rejects a private 10.x address', async () => {
    mockResolves([{ address: '10.0.0.5', family: 4 }]);
    await expect(assertFetchableUrl('http://internal-host/cal.ics')).rejects.toThrow();
  });

  it('rejects a private address even when one of several resolved addresses is public', async () => {
    mockResolves([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ]);
    await expect(assertFetchableUrl('http://multi-homed/cal.ics')).rejects.toThrow();
  });

  it('rejects an IPv4-mapped IPv6 loopback address', async () => {
    mockResolves([{ address: '::ffff:127.0.0.1', family: 6 }]);
    await expect(assertFetchableUrl('http://sneaky-host/cal.ics')).rejects.toThrow();
  });

  it('rejects an IPv6 link-local address', async () => {
    mockResolves([{ address: 'fe80::1', family: 6 }]);
    await expect(assertFetchableUrl('http://v6-link-local/cal.ics')).rejects.toThrow();
  });

  it('accepts a normal public https URL', async () => {
    mockResolves([{ address: '93.184.216.34', family: 4 }]);
    const url = await assertFetchableUrl('https://calendar.example.com/secret-token.ics');
    expect(url.hostname).toBe('calendar.example.com');
  });

  it('rejects a non-http scheme', async () => {
    await expect(assertFetchableUrl('file:///etc/passwd')).rejects.toThrow();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects a URL carrying embedded credentials', async () => {
    mockResolves([{ address: '93.184.216.34', family: 4 }]);
    await expect(
      assertFetchableUrl('https://user:pass@calendar.example.com/secret.ics'),
    ).rejects.toThrow();
  });

  it('rejects an unparseable string', async () => {
    await expect(assertFetchableUrl('not a url at all')).rejects.toThrow();
  });
});
