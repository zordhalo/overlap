import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildAuthUrl, isGoogleConfigured, signState } from '@/lib/google';
import { getCircleBySlug } from '@/lib/db/queries';
import { getSessionMemberId } from '@/lib/session';

/**
 * Begins the Google connection for whoever this browser already is.
 *
 * The member is taken from the session cookie, never from a query parameter:
 * a caller-supplied member id would let anyone attach their own Google account
 * to someone else's row, which is both an impersonation and a way to feed
 * false availability into a circle.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: 'Google Calendar is not configured on this deployment.' },
      { status: 501 },
    );
  }

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: '"slug" is required.' }, { status: 400 });

  const circle = await getCircleBySlug(slug);
  if (!circle) return NextResponse.json({ error: 'No such circle.' }, { status: 404 });

  const memberId = await getSessionMemberId(slug);
  const isMember = memberId !== null && circle.members.some((m) => m.id === memberId);
  if (!memberId || !isMember) {
    // Not a member yet: send them to join first rather than failing. Arriving
    // at an error page after clicking "connect" would read as the integration
    // being broken.
    return NextResponse.redirect(new URL(`/c/${slug}/join`, url.origin));
  }

  const state = signState({ slug, memberId, nonce: randomUUID() });
  return NextResponse.redirect(buildAuthUrl(url.origin, state));
}
