import { NextResponse } from 'next/server';
import { getCircleBySlug, getMemberEmailHash } from '@/lib/db/queries';
import { setSessionMemberId } from '@/lib/session';
import { verifySigninToken } from '@/lib/signin-token';

/**
 * Where a recovery email's link lands: turns "I can prove I own this inbox"
 * into "this browser is me again", then shows the circle.
 *
 * Without it, a recovered link opened on a new device reached the circle as a
 * stranger, and the only offer on screen was "Add yourself", which made a
 * duplicate of the person instead of letting them edit themselves.
 *
 * A bad or expired link goes to recovery with a note, not to an error page:
 * the fix is always "ask for a fresh email", so the page should offer that.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const url = new URL(request.url);
  const token = url.searchParams.get('t') ?? '';

  const circle = await getCircleBySlug(slug);
  const claims = circle
    ? await verifySigninToken(token, {
        slug,
        // The member must still be in this circle, not merely have existed.
        currentEmailHash: async (memberId) =>
          circle.members.some((m) => m.id === memberId) ? getMemberEmailHash(memberId) : null,
      })
    : null;

  if (!claims) {
    return NextResponse.redirect(new URL('/recover?link=expired', url.origin));
  }

  await setSessionMemberId(slug, claims.memberId);
  return NextResponse.redirect(new URL(`/c/${slug}`, url.origin));
}
