'use server';

/**
 * Server actions backing the two forms this app has: creating a circle, and
 * joining one. Both validate their own inputs before calling into
 * `@/lib/db/queries` — that module validates too (see its assert* helpers),
 * but a boundary re-checks its own inputs rather than trusting a caller to
 * have done it, per the brief's "validate at boundaries, do both" rule.
 */

import { redirect } from 'next/navigation';
import { addMember, createCircle, getCircleBySlug } from '@/lib/db/queries';
import { setSessionMemberId } from '@/lib/session';
import { isValidTimezone, zoneInfo } from '@/lib/zones';

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

  redirect(`/c/${slug}`);
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

  await setSessionMemberId(circleSlug, id);
  redirect(`/c/${circleSlug}`);
}
