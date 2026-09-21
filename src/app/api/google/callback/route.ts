import { NextResponse } from 'next/server';
import { exchangeCode, GOOGLE_EVENTS_SCOPE, GOOGLE_SCOPE, isGoogleConfigured, verifyState } from '@/lib/google';
import { sendCircleInvite } from '@/lib/circle-invite';
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
    // Declining the write scope is not declining availability: the existing
    // connection is untouched, so say only that the invite was not sent.
    const back = verifiedOnDeny
      ? `/c/${verifiedOnDeny.slug}${verifiedOnDeny.invite ? '?calendar=invite-declined' : ''}`
      : '/';
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
  let scopes: string[];
  try {
    ({ refreshToken, scopes } = await exchangeCode(code, url.origin));
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

  // With granular consent a person can untick scopes. A token without the
  // availability scope would silently stop busy sync, so it only replaces the
  // stored one when it still carries that scope (or Google did not say).
  const keepsAvailability = scopes.length === 0 || scopes.includes(GOOGLE_SCOPE);
  if (keepsAvailability) await setGoogleRefreshToken(state.memberId, refreshToken);

  if (!state.invite) {
    return NextResponse.redirect(new URL(`/c/${state.slug}?calendar=connected`, url.origin));
  }

  // The reason this grant was asked for: send the invite now, so the click
  // that started it is the only click it took.
  if (!scopes.includes(GOOGLE_EVENTS_SCOPE)) {
    return NextResponse.redirect(new URL(`/c/${state.slug}?calendar=invite-declined`, url.origin));
  }
  if (!keepsAvailability) {
    // Nothing stored to write with. Rare enough (unticking availability while
    // granting writes) that failing plainly beats a special path.
    return NextResponse.redirect(new URL(`/c/${state.slug}?calendar=invite-failed`, url.origin));
  }
  const base = (process.env.NEXT_PUBLIC_BASE_URL || url.origin).replace(/\/$/, '');
  const outcome = await sendCircleInvite(circle, state.memberId, state.invite, base);
  const notice = outcome.status === 'sent' ? 'invite-sent' : 'invite-failed';
  return NextResponse.redirect(new URL(`/c/${state.slug}?calendar=${notice}`, url.origin));
}
