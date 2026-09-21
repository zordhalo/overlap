/**
 * "Add to Google Calendar" for one member, shared by the two places it can
 * happen: the button (a server action) and the OAuth callback, when the click
 * first had to go and ask Google for write access.
 *
 * Both callers must already have established that `memberId` belongs to
 * `circle` — the action from the session cookie, the callback from the
 * signed `state`. This module trusts that and checks everything else.
 */

import { addGoogleEvent, isGoogleConfigured, type AddEventResult } from '@/lib/google';
import { getGoogleRefreshToken, type CircleWithMembers } from '@/lib/db/queries';

/** Same ceiling as the .ics route: no single meeting slot is longer. */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export type AddToGoogleOutcome =
  | AddEventResult
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

export async function addSlotToGoogle(
  circle: CircleWithMembers,
  memberId: string,
  slot: { start: number; end: number },
  origin: string,
): Promise<AddToGoogleOutcome> {
  if (!isValidSlot(slot.start, slot.end)) return { status: 'invalid' };
  if (!isGoogleConfigured()) return { status: 'not-connected' };

  const refreshToken = await getGoogleRefreshToken(memberId);
  if (!refreshToken) return { status: 'not-connected' };

  try {
    return await addGoogleEvent(refreshToken, {
      circleId: circle.id,
      start: slot.start,
      end: slot.end,
      summary: circle.name,
      description: 'Scheduled with Overlap.',
      url: `${origin}/c/${circle.slug}`,
    });
  } catch (error) {
    // Logged without the token or the event: the message names only the
    // status Google returned, which is what diagnosing this needs.
    console.error('Add to Google Calendar failed:', error instanceof Error ? error.message : error);
    return { status: 'failed' };
  }
}
