import { NextResponse } from 'next/server';
import { exchangeCode, isGoogleConfigured, verifyState } from '@/lib/google';
import { getCircleBySlug, setGoogleRefreshToken } from '@/lib/db/queries';

/**
 * Where Google sends the user back.
 *
 * Everything here is treated as untrusted input: `state` is verified before
 * it is read, and the member it names is re-checked against the circle it
 * names, so a replayed or hand-written callback cannot attach a Google account
 * to an arbitrary row.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google Calendar is not configured.' }, { status: 501 });
  }

  // The user declining is a normal outcome, not an error: send them back to
  // the circle rather than showing a failure page for a choice they made.
  const denied = url.searchParams.get('error');
  const stateParam = url.searchParams.get('state');
  const verifiedOnDeny = stateParam ? verifyState(stateParam) : null;
  if (denied) {
    const back = verifiedOnDeny ? `/c/${verifiedOnDeny.slug}` : '/';
    return NextResponse.redirect(new URL(back, url.origin));
  }

  const code = url.searchParams.get('code');
  if (!code || !stateParam) {
    return NextResponse.json({ error: 'Missing code or state.' }, { status: 400 });
  }

  const state = verifyState(stateParam);
  if (!state) {
    return NextResponse.json({ error: 'State failed verification.' }, { status: 400 });
  }

  const circle = await getCircleBySlug(state.slug);
  if (!circle || !circle.members.some((m) => m.id === state.memberId)) {
    return NextResponse.json({ error: 'That member is not in that circle.' }, { status: 400 });
  }

  let refreshToken: string | null;
  try {
    ({ refreshToken } = await exchangeCode(code, url.origin));
  } catch {
    return NextResponse.redirect(new URL(`/c/${state.slug}?calendar=failed`, url.origin));
  }

  if (!refreshToken) {
    // Google only returns a refresh token when it feels like it — a prior
    // grant with no `prompt=consent` yields none. We always send
    // prompt=consent, so reaching here means something is off rather than
    // being a normal path worth silently swallowing.
    return NextResponse.redirect(new URL(`/c/${state.slug}?calendar=no-refresh-token`, url.origin));
  }

  await setGoogleRefreshToken(state.memberId, refreshToken);
  return NextResponse.redirect(new URL(`/c/${state.slug}?calendar=connected`, url.origin));
}
