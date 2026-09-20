/**
 * Guards against SSRF when the server fetches a member-supplied iCal URL.
 *
 * `ics_url` is attacker-controlled input that we make an outbound request
 * to. Without this guard, any member could paste an internal address (a
 * database on the private network) or a cloud metadata endpoint
 * (169.254.169.254) and turn our server into their proxy into
 * infrastructure they otherwise cannot reach.
 *
 * Hostname allowlisting alone is not enough — a hostname can *resolve* to a
 * private address even though it looks public — so this checks the resolved
 * IP addresses, not the hostname string.
 *
 * Residual risk, accepted and documented rather than silently ignored: this
 * only narrows DNS rebinding, it does not eliminate it. The caller (the
 * actual `fetch`) resolves the hostname again, and nothing stops the DNS
 * answer from changing between this check and that request. Closing that
 * gap fully needs pinning the resolved IP and connecting to it directly
 * (e.g. a custom `fetch` dispatcher), which is the pages/ics agent's call
 * to make when it wires up the real request.
 */
import { lookup } from 'node:dns/promises';
import { BlockList } from 'node:net';

const disallowed = new BlockList();

// IPv4
disallowed.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network"
disallowed.addSubnet('10.0.0.0', 8, 'ipv4'); // private
disallowed.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
disallowed.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
disallowed.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local — covers the 169.254.169.254 cloud metadata address
disallowed.addSubnet('172.16.0.0', 12, 'ipv4'); // private
disallowed.addSubnet('192.168.0.0', 16, 'ipv4'); // private
disallowed.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast

// IPv6
disallowed.addAddress('::1', 'ipv6'); // loopback
disallowed.addSubnet('fc00::', 7, 'ipv6'); // unique-local
disallowed.addSubnet('fe80::', 10, 'ipv6'); // link-local
disallowed.addSubnet('ff00::', 8, 'ipv6'); // multicast

/** Matches an IPv4-mapped IPv6 literal, e.g. "::ffff:127.0.0.1", which would
 *  otherwise sail past the ipv6 checks above while actually being IPv4. */
const IPV4_MAPPED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

function isPublicAddress(address: string, family: 4 | 6): boolean {
  if (family === 6) {
    const mapped = IPV4_MAPPED.exec(address);
    if (mapped) {
      return !disallowed.check(mapped[1] as string, 'ipv4');
    }
  }
  return !disallowed.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Validates that `raw` is safe to fetch server-side, returning the parsed
 * `URL` on success. Throws a descriptive error otherwise. Resolves DNS as
 * part of validation, so this is async despite taking a plain string.
 */
export async function assertFetchableUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: "${raw}"`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`URL scheme must be http or https, got "${url.protocol}"`);
  }
  if (url.username || url.password) {
    throw new Error('URL must not contain embedded credentials (user:pass@)');
  }

  const hostname = url.hostname;
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(
      `Could not resolve hostname "${hostname}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (addresses.length === 0) {
    throw new Error(`Hostname "${hostname}" did not resolve to any address`);
  }

  for (const { address, family } of addresses) {
    const fam = family === 6 ? 6 : 4;
    if (!isPublicAddress(address, fam)) {
      throw new Error(
        `Refusing to fetch "${hostname}": resolves to ${address}, which is not a public address`,
      );
    }
  }

  return url;
}
