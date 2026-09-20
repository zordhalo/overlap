/**
 * Google's free/busy query: the only calendar data Overlap ever reads.
 *
 * The endpoint returns `{ start, end }` pairs and nothing else. There is no
 * title, attendee list or location in the response to accidentally log, store
 * or leak — the narrowest possible answer to "when is this person busy".
 */

import type { Interval } from '@/lib/schedule/types';
import { accessTokenFromRefresh } from './oauth';

const FREEBUSY_ENDPOINT = 'https://www.googleapis.com/calendar/v3/freeBusy';
const REQUEST_TIMEOUT_MS = 8_000;

/** Google rejects windows longer than this on a single freeBusy call. */
const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

type FreeBusyResponse = {
  calendars?: Record<string, { busy?: { start?: string; end?: string }[]; errors?: unknown[] }>;
};

/**
 * Busy intervals for the member's primary calendar over `[from, to)`.
 *
 * Throws on any failure rather than returning an empty array. An empty array
 * means "this person is genuinely free", and a failed request must never be
 * able to say that — the caller (`syncMemberBusy`) is built to keep the last
 * known good data when this throws.
 */
export async function fetchGoogleBusy(
  refreshToken: string,
  opts: { from: number; to: number; signal?: AbortSignal },
): Promise<Interval[]> {
  const from = opts.from;
  const to = Math.min(opts.to, opts.from + MAX_WINDOW_MS);
  if (to <= from) return [];

  const accessToken = await accessTokenFromRefresh(refreshToken);

  const response = await fetch(FREEBUSY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      items: [{ id: 'primary' }],
    }),
    signal: opts.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Google freeBusy failed: ${response.status}`);
  }

  const json = (await response.json()) as FreeBusyResponse;
  const calendar = json.calendars?.['primary'];

  // A per-calendar `errors` entry means Google answered 200 while refusing
  // this particular calendar (revoked grant, calendar deleted). Treating that
  // as "no busy time" would silently mark the person free, so it throws.
  if (calendar?.errors && calendar.errors.length > 0) {
    throw new Error('Google freeBusy returned a calendar-level error.');
  }

  const busy = calendar?.busy ?? [];
  return busy
    .map((b) => ({
      start: b.start ? Date.parse(b.start) : Number.NaN,
      end: b.end ? Date.parse(b.end) : Number.NaN,
    }))
    .filter((iv): iv is Interval => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start)
    .map((iv) => ({ start: Math.max(iv.start, from), end: Math.min(iv.end, to) }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start);
}
