/**
 * Sending the circle's calendar invite.
 *
 * One event, on the calendar of whoever sends it (the organizer), with every
 * member who opted in as a guest. Google, not Overlap, emails the invitations
 * (`sendUpdates=all`), so the invite arrives the way any other meeting does
 * and accepting it puts it in each person's own calendar.
 *
 * Idempotent by construction. A new invite's id is derived from the circle
 * and the slot, so a double click or a retry after a timeout lands on the same
 * event instead of inviting everyone twice. Changing the time afterwards
 * moves that event (`moveGoogleInvite`) rather than creating another.
 */

import { createHash } from 'node:crypto';
import { accessTokenWithScopes, GOOGLE_EVENTS_SCOPE } from './oauth';

const EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
/** Google sends the invitation, update or restore mail itself. */
const NOTIFY = '?sendUpdates=all';
const REQUEST_TIMEOUT_MS = 8_000;

export type GoogleEventInput = {
  circleId: string;
  start: number;
  end: number;
  summary: string;
  description: string;
  /** The circle page, so the event links back to where it was agreed. */
  url: string;
  /** Guests. The organizer is not listed: the event is on their calendar. */
  attendees: { email: string; name: string }[];
};

export type InviteResult =
  | { status: 'sent'; eventId: string; htmlLink: string | null }
  /** The stored grant predates the write scope, or the person unticked it. */
  | { status: 'needs-permission' };

export type MoveInviteResult =
  | InviteResult
  /** The organizer deleted the event outright, so there is nothing to move. */
  | { status: 'gone' };

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

function eventBody(input: GoogleEventInput) {
  return {
    summary: input.summary,
    description: `${input.description}\n\n${input.url}`,
    start: { dateTime: new Date(input.start).toISOString() },
    end: { dateTime: new Date(input.end).toISOString() },
    source: { title: 'Overlap', url: input.url },
    attendees: input.attendees.map((a) => ({ email: a.email, displayName: a.name })),
    // Re-asserted on every write so re-sending an invite the organizer
    // deleted restores it rather than leaving a cancelled tombstone in place.
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

/** A 403 for a missing scope is a permission problem, not a failure: the
 *  person is offered the fix rather than an error. Anything else throws. */
async function refusal(response: Response, what: string): Promise<{ status: 'needs-permission' }> {
  const detail = await response.text().catch(() => '');
  if (response.status === 403 && /insufficient|scope/i.test(detail)) {
    return { status: 'needs-permission' };
  }
  throw new Error(`Google ${what} failed: ${response.status} ${detail.slice(0, 200)}`);
}

/**
 * Checked before calling, not inferred from a 403 afterwards: the refresh
 * response states the grant's scopes outright, and asking first means the
 * common case (connected for availability only) costs no failed write.
 */
async function writeToken(refreshToken: string): Promise<string | null> {
  const { accessToken, scopes } = await accessTokenWithScopes(refreshToken);
  return scopes.includes(GOOGLE_EVENTS_SCOPE) ? accessToken : null;
}

/**
 * Create the invite on the organizer's primary calendar and mail the guests.
 *
 * Throws on anything unexpected (network, 5xx, revoked grant). The caller
 * falls back to the .ics download in that case; there is no failure here that
 * should leave someone without a way to get the meeting into their calendar.
 */
export async function sendGoogleInvite(
  refreshToken: string,
  input: GoogleEventInput,
): Promise<InviteResult> {
  const accessToken = await writeToken(refreshToken);
  if (!accessToken) return { status: 'needs-permission' };

  const id = googleEventId(input.circleId, input.start, input.end);
  const body = eventBody(input);

  const inserted = await callGoogle(accessToken, EVENTS_ENDPOINT + NOTIFY, {
    method: 'POST',
    body: { id, ...body },
  });
  if (inserted.ok) {
    const event = (await inserted.json()) as GoogleEvent;
    return { status: 'sent', eventId: id, htmlLink: event.htmlLink ?? null };
  }
  if (inserted.status !== 409) return refusal(inserted, 'invite insert');

  // 409: this invite already exists on the organizer's calendar — a retry,
  // or one they deleted (Google keeps deleted events as `cancelled`, and the
  // id stays taken). Overwriting it restores a deleted one and brings the
  // guest list up to date, which is what pressing "send" again should mean.
  const replaced = await callGoogle(accessToken, `${EVENTS_ENDPOINT}/${id}${NOTIFY}`, {
    method: 'PUT',
    body,
  });
  if (!replaced.ok) return refusal(replaced, 'invite restore');
  const event = (await replaced.json()) as GoogleEvent;
  return { status: 'sent', eventId: id, htmlLink: event.htmlLink ?? null };
}

/**
 * Move an invite that already went out to a new time.
 *
 * The same event, patched, so guests get one "updated invitation" and their
 * calendars move the meeting, instead of a second invite beside the first.
 * `refreshToken` must be the organizer's: it is their calendar the event is on.
 */
export async function moveGoogleInvite(
  refreshToken: string,
  eventId: string,
  input: GoogleEventInput,
): Promise<MoveInviteResult> {
  const accessToken = await writeToken(refreshToken);
  if (!accessToken) return { status: 'needs-permission' };

  const moved = await callGoogle(accessToken, `${EVENTS_ENDPOINT}/${eventId}${NOTIFY}`, {
    method: 'PATCH',
    body: eventBody(input),
  });
  if (moved.status === 404 || moved.status === 410) return { status: 'gone' };
  if (!moved.ok) return refusal(moved, 'invite move');
  const event = (await moved.json()) as GoogleEvent;
  return { status: 'sent', eventId, htmlLink: event.htmlLink ?? null };
}
