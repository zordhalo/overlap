'use server';

/**
 * Server actions backing the two forms this app has: creating a circle, and
 * joining one. Both validate their own inputs before calling into
 * `@/lib/db/queries` — that module validates too (see its assert* helpers),
 * but a boundary re-checks its own inputs rather than trusting a caller to
 * have done it, per the brief's "validate at boundaries, do both" rule.
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { looksLikeEmail, normaliseEmail } from '@/lib/email';
import {
  addMember,
  clearChosenSlot,
  clearMemberEmail,
  createCircle,
  getCircleBySlug,
  setChosenSlot,
  setMemberEmail,
  updateMember,
} from '@/lib/db/queries';
import {
  clearSessionMemberId,
  getSessionMemberId,
  setSessionMemberId,
} from '@/lib/session';
import { isValidTimezone, zoneInfo } from '@/lib/zones';
import { addSlotToGoogle, type AddToGoogleOutcome } from '@/lib/add-to-google';

/** Fixed defaults for the one-screen create form, which asks only for a
 *  name. 30 minutes covers most standing syncs; a two-week horizon is long
 *  enough to almost always surface a slot without searching so far out that
 *  ranking stops being meaningful. Both are circle-level fields with no UI
 *  to edit them tonight, but stored as real, sane values rather than
 *  placeholders a future settings screen has to fix. */
const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_HORIZON_DAYS = 14;

export async function createCircleAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    throw new Error('Circle name is required.');
  }
  if (name.length > 100) {
    throw new Error('Circle name must be 100 characters or fewer.');
  }

  const { slug } = await createCircle({
    name,
    durationMinutes: DEFAULT_DURATION_MINUTES,
    horizonDays: DEFAULT_HORIZON_DAYS,
  });

  // Straight into setting yourself up, not to the circle.
  //
  // Creating a circle and landing on "nobody has joined yet" makes the person
  // who just made it a spectator at their own table: they then have to notice
  // a "join this circle" button and take a second, separate action to be in
  // the thing they created. Whoever creates a circle is obviously in it, so
  // creation continues directly into their own setup, and the circle page is
  // where they arrive once they are actually a member.
  redirect(`/c/${slug}/join?new=1`);
}

/** Parses an `<input type="time">` value ("HH:MM") into local minutes from
 *  midnight. Returns `null` for anything that doesn't match, so the caller
 *  can produce one clear validation error instead of a NaN reaching the db
 *  layer's own range assertion. */
function parseTimeToMinutes(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export async function joinCircleAction(circleSlug: string, formData: FormData): Promise<void> {
  const circle = await getCircleBySlug(circleSlug);
  if (!circle) {
    throw new Error(`No circle found for "${circleSlug}".`);
  }

  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    throw new Error('Your name is required.');
  }
  if (name.length > 100) {
    throw new Error('Name must be 100 characters or fewer.');
  }

  const timezone = String(formData.get('timezone') ?? '');
  if (!isValidTimezone(timezone)) {
    throw new Error(`"${timezone}" is not a recognized timezone.`);
  }

  const sleepStart = parseTimeToMinutes(formData.get('sleepStart'));
  const sleepEnd = parseTimeToMinutes(formData.get('sleepEnd'));
  const workStart = parseTimeToMinutes(formData.get('workStart'));
  const workEnd = parseTimeToMinutes(formData.get('workEnd'));
  if (sleepStart === null || sleepEnd === null || workStart === null || workEnd === null) {
    throw new Error('Sleep and working hours must be valid times.');
  }

  // The iCal URL field is optional and must stay that way end to end: an
  // empty paste is simply "no calendar," never a validation error.
  const icsUrlRaw = String(formData.get('icsUrl') ?? '').trim();
  let icsUrl: string | undefined;
  if (icsUrlRaw) {
    let parsed: URL;
    try {
      parsed = new URL(icsUrlRaw);
    } catch {
      throw new Error('The calendar URL is not a valid URL.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('The calendar URL must be http or https.');
    }
    icsUrl = icsUrlRaw;
  }

  // Best-effort marker placement for the globe; a zone the curated table
  // doesn't cover still resolves via zones.ts's offset fallback, so this
  // never throws over an obscure-but-valid zone.
  const { lat, lng } = zoneInfo(timezone);

  // Optional recovery address. Normalised and validated here; the db layer
  // encrypts it and stores a keyed hash for lookup. Blank is a legitimate
  // answer and must stay one — "no account" is only true if skipping this
  // costs nothing.
  const emailRaw = String(formData.get('email') ?? '').trim();
  const email = emailRaw ? normaliseEmail(emailRaw) : '';
  if (email && !looksLikeEmail(email)) {
    throw new Error('That does not look like an email address.');
  }

  // Returning visitor: this browser already holds a session for a member of
  // THIS circle, so the join page is an edit, not a second sign-up. Without
  // this branch a returning member silently becomes a duplicate — and the
  // join page explicitly promises "you can come back and change any of this
  // later from the same browser", which would be a promise the code breaks.
  //
  // The cookie is only trusted after confirming the id is actually a member of
  // this circle: a stale or hand-edited cookie must fall through to creating a
  // member, never update someone else's row.
  const sessionMemberId = await getSessionMemberId(circleSlug);
  const existing = sessionMemberId
    ? circle.members.find((m) => m.id === sessionMemberId)
    : undefined;

  if (existing) {
    // The edit form is prefilled with the saved address, so the field is the
    // whole truth: a value replaces it, and emptying it removes it. Only when
    // the address was actually shown, though: an unreadable one renders as an
    // empty field, and saving must not wipe something the user never saw.
    if (email) await setMemberEmail(existing.id, email);
    else if (existing.hasEmail && formData.get('emailShown') === '1') {
      await clearMemberEmail(existing.id);
    }
    await updateMember(existing.id, {
      name,
      timezone,
      sleepStart,
      sleepEnd,
      workStart,
      workEnd,
      lat,
      lng,
      // Leave the stored calendar alone when the field came back empty, so
      // editing your sleep hours does not quietly disconnect your calendar.
      ...(icsUrl ? { icsUrl } : {}),
    });
    redirect(`/c/${circleSlug}`);
  }

  const { id } = await addMember(circle.id, {
    name,
    timezone,
    sleepStart,
    sleepEnd,
    workStart,
    workEnd,
    icsUrl,
    lat,
    lng,
  });

  if (email) await setMemberEmail(id, email);

  await setSessionMemberId(circleSlug, id);
  // The first member has nobody to meet with yet, so their next action is not
  // scheduling, it is inviting. Flagged here so the circle page can lead with
  // the link instead of an empty suggestion list.
  const isFirst = circle.members.length === 0;
  redirect(`/c/${circleSlug}${isFirst ? '?invite=1' : ''}`);
}


/**
 * Agree on a time, for everyone.
 *
 * Picking a slot used to produce only a private .ics, which left the group to
 * settle "so, Tuesday 3pm?" in chat — the exact negotiation this product
 * exists to end. Writing the choice to the circle makes it part of what the
 * link shows, so sharing the link IS telling people the time.
 *
 * Any member may set or change it. Three co-founders do not need a permissions
 * model, and adding one would be the wrong answer to a social problem.
 */
export async function chooseSlotAction(
  circleSlug: string,
  start: number,
  end: number,
): Promise<void> {
  const circle = await getCircleBySlug(circleSlug);
  if (!circle) throw new Error('That circle does not exist.');

  // Attribution only, and only if the cookie really names a member of THIS
  // circle. A stale or forged cookie records an anonymous choice rather than
  // crediting — or impersonating — somebody else.
  const sessionMemberId = await getSessionMemberId(circleSlug);
  const byMemberId = circle.members.some((m) => m.id === sessionMemberId)
    ? sessionMemberId
    : null;

  await setChosenSlot(circle.id, byMemberId, start, end);
  revalidatePath(`/c/${circleSlug}`);
}

/**
 * What the "Add to Google Calendar" button gets back. `needs-permission`
 * carries the URL that asks Google for write access and then finishes the
 * add, so the client only has to navigate to it.
 */
export type AddToGoogleResult =
  | Exclude<AddToGoogleOutcome, { status: 'needs-permission' }>
  | { status: 'needs-permission'; url: string };

/**
 * Put a slot straight into the signed-in member's own Google Calendar.
 *
 * The member comes from the session cookie and must belong to this circle;
 * nobody can write into anyone else's calendar through this, because the only
 * refresh token it ever reads is the caller's own.
 */
export async function addToGoogleCalendarAction(
  circleSlug: string,
  start: number,
  end: number,
): Promise<AddToGoogleResult> {
  const circle = await getCircleBySlug(circleSlug);
  if (!circle) return { status: 'invalid' };

  const sessionMemberId = await getSessionMemberId(circleSlug);
  const me = circle.members.find((m) => m.id === sessionMemberId);
  if (!me || me.calendarSource !== 'google') return { status: 'not-connected' };

  const outcome = await addSlotToGoogle(circle, me.id, { start, end }, await siteOrigin());
  if (outcome.status === 'needs-permission') {
    return { status: 'needs-permission', url: `/c/${circleSlug}/google?add=${start}-${end}` };
  }
  return outcome;
}

/** The public origin, for the link back to the circle inside the event. Same
 *  override the OAuth redirect URI honours, so both name the same host. */
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** Reopen the question. */
export async function clearChosenAction(circleSlug: string): Promise<void> {
  const circle = await getCircleBySlug(circleSlug);
  if (!circle) throw new Error('That circle does not exist.');
  await clearChosenSlot(circle.id);
  revalidatePath(`/c/${circleSlug}`);
}

/**
 * Forget who this browser is for this circle, so one person can set up several
 * members from one browser — the first thing anyone does when they want to see
 * what the link will look like before sending it to three colleagues.
 */
export async function switchMemberAction(circleSlug: string): Promise<void> {
  await clearSessionMemberId(circleSlug);
  redirect(`/c/${circleSlug}/join`);
}
