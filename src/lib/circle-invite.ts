/**
 * Sending the circle's calendar invite, shared by the two places it can
 * happen: the button (a server action) and the OAuth callback, when the click
 * first had to go and ask Google for write access.
 *
 * Both callers must already have established that `memberId` belongs to
 * `circle` — the action from the session cookie, the callback from the
 * signed `state`. This module trusts that and checks everything else.
 *
 * The rule for whose calendar the event lives on: the first person to send it
 * is the organizer, and it stays theirs. Anyone in the circle may later move
 * it to a new time (anyone may change the agreed time, too), and the move is
 * written with the organizer's grant, because it is their event. Only if that
 * grant is gone does whoever is sending now start a fresh invite of their own.
 */

import {
  isGoogleConfigured,
  moveGoogleInvite,
  sendGoogleInvite,
  type GoogleEventInput,
} from '@/lib/google';
import {
  getGoogleRefreshToken,
  inviteeEmails,
  setCircleInvite,
  type CircleWithMembers,
} from '@/lib/db/queries';

/** Same ceiling as the .ics route: no single meeting slot is longer. */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export type InviteOutcome =
  | { status: 'sent'; htmlLink: string | null; invited: string[] }
  | { status: 'needs-permission' }
  | { status: 'not-connected' }
  | { status: 'invalid' }
  | { status: 'failed' };

export function isValidSlot(start: unknown, end: unknown): start is number {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    (end as number) > (start as number) &&
    (end as number) - (start as number) <= MAX_DURATION_MS
  );
}

export async function sendCircleInvite(
  circle: CircleWithMembers,
  memberId: string,
  slot: { start: number; end: number },
  origin: string,
): Promise<InviteOutcome> {
  if (!isValidSlot(slot.start, slot.end)) return { status: 'invalid' };
  if (!isGoogleConfigured()) return { status: 'not-connected' };

  const eventFor = async (organizerId: string) => {
    const guests = await inviteeEmails(circle.id, organizerId);
    const input: GoogleEventInput = {
      circleId: circle.id,
      start: slot.start,
      end: slot.end,
      summary: circle.name,
      description: 'Scheduled with Overlap.',
      url: `${origin}/c/${circle.slug}`,
      attendees: guests.map((g) => ({ email: g.email, name: g.name })),
    };
    return { input, invited: guests.map((g) => g.name) };
  };

  try {
    // An invite already went out: move it, on the organizer's calendar.
    const existing = circle.invite;
    const organizerStillHere =
      existing && circle.members.some((m) => m.id === existing.organizerId);
    const organizerToken = organizerStillHere
      ? await getGoogleRefreshToken(existing.organizerId)
      : null;
    if (existing && organizerToken) {
      const { input, invited } = await eventFor(existing.organizerId);
      const moved = await moveGoogleInvite(organizerToken, existing.eventId, input);
      if (moved.status === 'sent') {
        await setCircleInvite(circle.id, { ...existing, start: slot.start, end: slot.end });
        return { status: 'sent', htmlLink: moved.htmlLink, invited };
      }
      // `gone` or the organizer revoked writes: nothing left to move, so the
      // person sending now becomes the organizer of a fresh invite, below.
    }

    const refreshToken = await getGoogleRefreshToken(memberId);
    if (!refreshToken) return { status: 'not-connected' };

    const { input, invited } = await eventFor(memberId);
    const sent = await sendGoogleInvite(refreshToken, input);
    if (sent.status !== 'sent') return sent;
    await setCircleInvite(circle.id, {
      eventId: sent.eventId,
      organizerId: memberId,
      start: slot.start,
      end: slot.end,
    });
    return { status: 'sent', htmlLink: sent.htmlLink, invited };
  } catch (error) {
    // Logged without the token, the event or any address: the message names
    // only the status Google returned, which is what diagnosing this needs.
    console.error('Sending the circle invite failed:', error instanceof Error ? error.message : error);
    return { status: 'failed' };
  }
}
