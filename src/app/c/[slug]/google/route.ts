import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildAuthUrl, isGoogleConfigured, signState } from '@/lib/google';
import { getCircleBySlug } from '@/lib/db/queries';
import { getSessionMemberId } from '@/lib/session';

/**
 * Begins the Google connection for whoever this browser already is.
 *
 * Lives under `/c/<slug>/` rather than `/api/` because the session cookie is
 * scoped to `path: /c/<slug>` (see `lib/session.ts`). At `/api/google/start`
 * the browser never sent it, so every member looked like a stranger and was
 * bounced to the join form, which offers only the iCal paste box. That read
 * as "Connect Google Calendar does not use Google".
 *
 * The member is taken from the session cookie, never from a query parameter:
 * a caller-supplied member id would let anyone attach their own Google account
 * to someone else's row, which is both an impersonation and a way to feed
 * false availability into a circle.
 *
 * The callback stays at `/api/google/callback`: it identifies the member from
 * the signed `state`, not the cookie, and it is the URI registered with Google.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: 'Google Calendar is not configured on this deployment.' },
      { status: 501 },
    );
  }

  const { slug } = await params;
  const url = new URL(request.url);

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
