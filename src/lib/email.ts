/**
 * Transactional mail, via Resend's HTTP API.
 *
 * Called directly rather than through the SDK: this sends exactly one kind of
 * message, and a dependency to POST one JSON body is not worth the install.
 *
 * Inert unless RESEND_API_KEY is set, like every other optional integration
 * here — a deployment without it simply never offers recovery, rather than
 * offering it and failing.
 */

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 8_000;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Must be an address on a Resend-verified domain, or mail fails auth. */
function sender(): string {
  return process.env.RESEND_FROM_EMAIL || 'overlap@advancelabs.dev';
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set.');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: sender(),
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // Body names the real cause (unverified domain, bad key) and contains no
    // user content beyond the recipient we already had.
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the message: ${response.status} ${detail.slice(0, 200)}`);
  }
}

/**
 * Normalised form used for both the stored hash and the lookup.
 *
 * Lowercased and trimmed only. Deliberately NOT doing provider-specific
 * tricks like stripping Gmail dots or +tags: two addresses that a provider
 * happens to deliver to one inbox are still two addresses, and silently
 * merging them would let one person's recovery return another's circles.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Deliberately permissive. The real validation is whether mail arrives. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
