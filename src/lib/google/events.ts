/**
 * Putting the agreed meeting into a member's own Google Calendar.
 *
 * The only write Overlap ever makes to Google, and deliberately a narrow one:
 * one event, on the member's primary calendar, with no attendees. Nobody else
 * is invited from here — each member adds the meeting to their own calendar,
 * so Overlap never sends mail on anyone's behalf or learns anyone's address
 * book.
 *
 * Idempotent by construction. The event id is derived from the circle and the
 * slot, so a double click, a retry after a timeout, or a second visit all land
 * on the same event instead of stacking duplicates in someone's week.
 */

import { createHash } from 'node:crypto';
import { accessTokenWithScopes, GOOGLE_EVENTS_SCOPE } from './oauth';

const EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const REQUEST_TIMEOUT_MS = 8_000;

export type GoogleEventInput = {
  circleId: string;
  start: number;
  end: number;
  summary: string;
  description: string;
  /** The circle page, so the event links back to where it was agreed. */
  url: string;
};

export type AddEventResult =
  | { status: 'added'; htmlLink: string | null }
  | { status: 'already'; htmlLink: string | null }
  /** The stored grant predates the write scope, or the person unticked it. */
  | { status: 'needs-permission' };

/**
 * A stable Google event id for one circle's meeting at one time.
 *
 * Google requires ids of 5–1024 characters drawn from base32hex (0-9, a-v).
 * Lowercase hex is a subset of that alphabet, so a SHA-256 digest is valid
 * as-is. The member is not part of the key: each member writes to their own
 * calendar, and ids only need to be unique per calendar.
 */
export function googleEventId(circleId: string, start: number, end: number): string {
  return createHash('sha256').update(`overlap:${circleId}:${start}:${end}`).digest('hex');
}

function eventBody(input: GoogleEventInput, id: string) {
  return {
    id,
    summary: input.summary,
    description: `${input.description}\n\n${input.url}`,
    start: { dateTime: new Date(input.start).toISOString() },
    end: { dateTime: new Date(input.end).toISOString() },
    source: { title: 'Overlap', url: input.url },
    // Re-asserted on every write so re-adding a meeting someone deleted
    // restores it rather than leaving a cancelled tombstone in place.
    status: 'confirmed',
  };
}

type GoogleEvent = { htmlLink?: string; status?: string };

async function callGoogle(
  accessToken: string,
  url: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  return fetch(url, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Insert the meeting, or confirm it is already there.
 *
 * Throws on anything unexpected (network, 5xx, revoked grant). The caller
 * falls back to the .ics download in that case; there is no failure here that
 * should leave someone without a way to get the meeting into their calendar.
 */
export async function addGoogleEvent(
  refreshToken: string,
  input: GoogleEventInput,
): Promise<AddEventResult> {
  const { accessToken, scopes } = await accessTokenWithScopes(refreshToken);

  // Checked before calling, not inferred from a 403 afterwards: the refresh
  // response states the grant's scopes outright, and asking first means the
  // common case (connected for availability only) costs no failed write.
  if (!scopes.includes(GOOGLE_EVENTS_SCOPE)) return { status: 'needs-permission' };

  const id = googleEventId(input.circleId, input.start, input.end);
  const body = eventBody(input, id);

  const inserted = await callGoogle(accessToken, EVENTS_ENDPOINT, { method: 'POST', body });
  if (inserted.ok) {
    const event = (await inserted.json()) as GoogleEvent;
    return { status: 'added', htmlLink: event.htmlLink ?? null };
  }

  // Insufficient scope despite the refresh saying otherwise (a grant changed
  // between the two calls). Treated as a permission problem, not a failure,
  // so the person is offered the fix rather than an error.
  if (inserted.status === 403) {
    const detail = await inserted.text().catch(() => '');
    if (/insufficient|scope/i.test(detail)) return { status: 'needs-permission' };
    throw new Error(`Google event insert refused: 403 ${detail.slice(0, 200)}`);
  }

  if (inserted.status !== 409) {
    throw new Error(`Google event insert failed: ${inserted.status}`);
  }

  // 409: an event with this id exists in the calendar, possibly one the
  // person deleted (Google keeps deleted events as `cancelled`, and their id
  // stays taken). Read it and restore it if so.
  const eventUrl = `${EVENTS_ENDPOINT}/${id}`;
  const existing = await callGoogle(accessToken, eventUrl, { method: 'GET' });
  if (!existing.ok) throw new Error(`Google event lookup failed: ${existing.status}`);
  const event = (await existing.json()) as GoogleEvent;

  if (event.status !== 'cancelled') {
    return { status: 'already', htmlLink: event.htmlLink ?? null };
  }

  const restored = await callGoogle(accessToken, eventUrl, { method: 'PUT', body });
  if (!restored.ok) throw new Error(`Google event restore failed: ${restored.status}`);
  const restoredEvent = (await restored.json()) as GoogleEvent;
  return { status: 'added', htmlLink: restoredEvent.htmlLink ?? null };
}
