/**
 * The single module boundary for all database access. No caller anywhere
 * else in the app may import Drizzle or the schema directly — that keeps the
 * store swappable in one file if Neon ever needs to be replaced.
 */
import { customAlphabet } from 'nanoid';
import { eq, and, gt } from 'drizzle-orm';
import type { Member } from '@/lib/schedule/types';
import { db } from './client';
import { circle, member, busy } from './schema';
import { encrypt, decrypt } from '../crypto';
import { assertValidTimezone as assertResolvableTimezone } from '../timezone';

/**
 * `busy` rows are a cache of calendar data. A sync run re-reads the source
 * calendar only when the newest cached row is older than this. Named and
 * exported rather than inlined so the refresh boundary (see
 * `replaceBusyForMember`) and any UI copy about staleness read the same
 * number.
 */
export const BUSY_CACHE_TTL_MS = 15 * 60 * 1000;

/** Hard ceiling on a single calendar sync fetch, so a dead or slow iCal host
 *  can never stall a page render. Used by `syncMemberBusy` below. */
export const ICS_FETCH_TIMEOUT_MS = 8_000;

/**
 * `slug` is a capability URL: possession of it is the only authorisation, so
 * it must be unguessable. 21 chars from nanoid's default URL-safe alphabet
 * (A-Za-z0-9_-) is comfortably over the 16-char floor the brief sets, and
 * matches nanoid's own default length so we are not hand-picking a weaker
 * one.
 */
const generateSlug = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  21,
);

/** Two-letter member tags, paired 1:1 with the six tints in PLAN.md section 6.
 *  `--pulse` (#98ff38) is reserved for the overlap and deliberately absent
 *  from this list — it must never be assignable to a member. */
const TAG_PALETTE: { tag: string; color: string }[] = [
  { tag: 'IC', color: '#7fb2ff' }, // ice
  { tag: 'BR', color: '#c9a227' }, // brass
  { tag: 'MT', color: '#8fd9c0' }, // mint
  { tag: 'OR', color: '#c58fd9' }, // orchid
  { tag: 'CL', color: '#d9a08f' }, // clay
  { tag: 'ST', color: '#9fa8b8' }, // steel
];

/**
 * A missing or malformed id must fail here, not as a Postgres not-null
 * violation several frames deeper. The error a caller sees should name the
 * argument they got wrong, not the column it landed in.
 */
function assertId(value: string, label: string): void {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID, got ${JSON.stringify(value)}`);
  }
}

function assertValidTimezone(timezone: string): void {
  // Delegated to lib/timezone, which validates by asking the runtime to
  // resolve the zone rather than by membership in Intl.supportedValuesOf().
  // That list omits Asia/Kolkata, Europe/Kyiv and Asia/Kathmandu while
  // including their deprecated spellings, so a membership check rejected real
  // members. See the comment block in lib/timezone.ts.
  assertResolvableTimezone(timezone, 'timezone');
}

function assertLocalMinutes(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 1439) {
    throw new Error(`${label} must be an integer in 0..1439, got ${value}`);
  }
}

function assertNonEmptyName(name: string, label: string): void {
  if (name.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}

export type CreateCircleInput = {
  name: string;
  durationMinutes: number;
  horizonDays: number;
};

export async function createCircle(input: CreateCircleInput): Promise<{ slug: string }> {
  assertNonEmptyName(input.name, 'Circle name');
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0 || input.durationMinutes > 1440) {
    throw new Error(`durationMinutes must be an integer in 1..1440, got ${input.durationMinutes}`);
  }
  if (!Number.isInteger(input.horizonDays) || input.horizonDays <= 0 || input.horizonDays > 365) {
    throw new Error(`horizonDays must be an integer in 1..365, got ${input.horizonDays}`);
  }

  const slug = generateSlug();
  await db.insert(circle).values({
    slug,
    name: input.name.trim(),
    durationMinutes: input.durationMinutes,
    horizonDays: input.horizonDays,
  });
  return { slug };
}

export type MemberRecord = {
  id: string;
  circleId: string;
  name: string;
  timezone: string;
  sleepStart: number;
  sleepEnd: number;
  workStart: number;
  workEnd: number;
  tag: string;
  color: string;
  lat: number | null;
  lng: number | null;
  /** Which connection a member is using, so the UI can name it accurately. */
  calendarSource: 'google' | 'ics' | null;
  /**
   * Whether a calendar is connected — deliberately a boolean, never the URL.
   * A secret iCal URL is a credential, so it stays encrypted in the database
   * and is decrypted only by the sync path. The UI needs to say "connected",
   * which this answers without the value ever leaving the db layer.
   */
  hasCalendar: boolean;
  busy: { start: number; end: number }[];
};

/** The time a circle agreed on. Null until somebody picks one. */
export type ChosenSlot = { start: number; end: number; byMemberId: string | null };

export type CircleWithMembers = {
  id: string;
  slug: string;
  name: string;
  durationMinutes: number;
  horizonDays: number;
  chosen: ChosenSlot | null;
  members: MemberRecord[];
};

/**
 * Fetches a circle plus its members and each member's cached busy intervals,
 * by slug — there is no by-id or list lookup exposed here, because the slug
 * is the only thing that should ever resolve a circle.
 */
export async function getCircleBySlug(slug: string): Promise<CircleWithMembers | null> {
  const circleRow = await db.query.circle.findFirst({ where: eq(circle.slug, slug) });
  if (!circleRow) return null;

  const chosen: ChosenSlot | null =
    circleRow.chosenStart !== null && circleRow.chosenEnd !== null
      ? { start: circleRow.chosenStart, end: circleRow.chosenEnd, byMemberId: circleRow.chosenBy }
      : null;

  const memberRows = await db.query.member.findMany({ where: eq(member.circleId, circleRow.id) });
  const members: MemberRecord[] = await Promise.all(
    memberRows.map(async (m) => {
      const busyRows = await db.query.busy.findMany({ where: eq(busy.memberId, m.id) });
      return {
        id: m.id,
        circleId: m.circleId,
        name: m.name,
        timezone: m.timezone,
        sleepStart: m.sleepStart,
        sleepEnd: m.sleepEnd,
        workStart: m.workStart,
        workEnd: m.workEnd,
        tag: m.tag,
        color: m.color,
        lat: m.lat,
        lng: m.lng,
        calendarSource: m.googleRefreshTokenEncrypted ? 'google' : m.icsUrlEncrypted ? 'ics' : null,
        hasCalendar: Boolean(m.icsUrlEncrypted || m.googleRefreshTokenEncrypted),
        busy: busyRows.map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() })),
      };
    }),
  );

  return {
    id: circleRow.id,
    slug: circleRow.slug,
    name: circleRow.name,
    durationMinutes: circleRow.durationMinutes,
    horizonDays: circleRow.horizonDays,
    chosen,
    members,
  };
}

/**
 * Maps DB rows onto the frozen `Member[]` shape the schedule engine speaks,
 * with no guesswork left to the caller.
 */
export function toScheduleMembers(circleWithMembers: CircleWithMembers): Member[] {
  return circleWithMembers.members.map((m) => ({
    id: m.id,
    name: m.name,
    timezone: m.timezone,
    sleepStart: m.sleepStart,
    sleepEnd: m.sleepEnd,
    workStart: m.workStart,
    workEnd: m.workEnd,
    busy: m.busy.map((b) => ({ start: b.start, end: b.end })),
    tag: m.tag,
    color: m.color,
    lat: m.lat,
    lng: m.lng,
  }));
}

export type AddMemberInput = {
  name: string;
  timezone: string;
  sleepStart: number;
  sleepEnd: number;
  workStart: number;
  workEnd: number;
  icsUrl?: string;
  lat?: number | null;
  lng?: number | null;
};

export async function addMember(circleId: string, input: AddMemberInput): Promise<{ id: string }> {
  assertId(circleId, 'circleId');
  assertNonEmptyName(input.name, 'Member name');
  assertValidTimezone(input.timezone);
  assertLocalMinutes(input.sleepStart, 'sleepStart');
  assertLocalMinutes(input.sleepEnd, 'sleepEnd');
  assertLocalMinutes(input.workStart, 'workStart');
  assertLocalMinutes(input.workEnd, 'workEnd');

  const { tag, color } = await assignNextTagAndColor(circleId);

  const [row] = await db
    .insert(member)
    .values({
      circleId,
      name: input.name.trim(),
      timezone: input.timezone,
      sleepStart: input.sleepStart,
      sleepEnd: input.sleepEnd,
      workStart: input.workStart,
      workEnd: input.workEnd,
      icsUrlEncrypted: input.icsUrl ? encrypt(input.icsUrl) : null,
      tag,
      color,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
    })
    .returning({ id: member.id });

  if (!row) {
    throw new Error('Failed to insert member');
  }
  return { id: row.id };
}

export type UpdateMemberInput = Partial<{
  name: string;
  timezone: string;
  sleepStart: number;
  sleepEnd: number;
  workStart: number;
  workEnd: number;
  icsUrl: string | null;
  lat: number | null;
  lng: number | null;
}>;

export async function updateMember(memberId: string, input: UpdateMemberInput): Promise<void> {
  const patch: Partial<typeof member.$inferInsert> = {};

  if (input.name !== undefined) {
    assertNonEmptyName(input.name, 'Member name');
    patch.name = input.name.trim();
  }
  if (input.timezone !== undefined) {
    assertValidTimezone(input.timezone);
    patch.timezone = input.timezone;
  }
  if (input.sleepStart !== undefined) {
    assertLocalMinutes(input.sleepStart, 'sleepStart');
    patch.sleepStart = input.sleepStart;
  }
  if (input.sleepEnd !== undefined) {
    assertLocalMinutes(input.sleepEnd, 'sleepEnd');
    patch.sleepEnd = input.sleepEnd;
  }
  if (input.workStart !== undefined) {
    assertLocalMinutes(input.workStart, 'workStart');
    patch.workStart = input.workStart;
  }
  if (input.workEnd !== undefined) {
    assertLocalMinutes(input.workEnd, 'workEnd');
    patch.workEnd = input.workEnd;
  }
  if (input.icsUrl !== undefined) {
    patch.icsUrlEncrypted = input.icsUrl === null ? null : encrypt(input.icsUrl);
  }
  if (input.lat !== undefined) patch.lat = input.lat;
  if (input.lng !== undefined) patch.lng = input.lng;

  if (Object.keys(patch).length === 0) return;

  await db.update(member).set(patch).where(eq(member.id, memberId));
}

/** Decrypts and returns a member's iCal URL, or null if they have none set. */
export async function getMemberIcsUrl(memberId: string): Promise<string | null> {
  const row = await db.query.member.findFirst({ where: eq(member.id, memberId) });
  if (!row?.icsUrlEncrypted) return null;
  return decrypt(row.icsUrlEncrypted);
}

/**
 * Replaces a member's cached busy intervals inside one transaction, tagged
 * with `source` and stamped `syncedAt = now`.
 *
 * Why this must be the only way `busy` rows are written: `busy` is a cache of
 * a calendar fetch, and a failed fetch is a normal, expected event (an
 * expired secret URL, a transient network error, a malformed .ics). If a
 * failed fetch cleared the old rows before the new ones arrived, "busy" would
 * silently become "free" — which is the worst possible failure direction for
 * a scheduler, since it invites double-booking exactly when the calendar
 * fetch is unreliable. So callers must only invoke this function with
 * intervals they actually parsed; on fetch failure they must call nothing at
 * all and let the existing cached rows stand until the next successful sync.
 */
export async function replaceBusyForMember(
  memberId: string,
  intervals: { start: number; end: number }[],
  source: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(busy).where(eq(busy.memberId, memberId));
    if (intervals.length === 0) return;
    await tx.insert(busy).values(
      intervals.map((interval) => ({
        memberId,
        startsAt: new Date(interval.start),
        endsAt: new Date(interval.end),
        source,
      })),
    );
  });
}

/** True when a member's cached busy data is older than `BUSY_CACHE_TTL_MS`
 *  (or has never been synced), meaning a refresh should be attempted. */
export async function isBusyStale(memberId: string): Promise<boolean> {
  const fresh = await db.query.busy.findFirst({
    where: and(eq(busy.memberId, memberId), gt(busy.syncedAt, new Date(Date.now() - BUSY_CACHE_TTL_MS))),
  });
  return !fresh;
}

/**
 * In-flight sync promises, keyed by member id. This dedups concurrent
 * refreshes so that N people opening the same circle link at once trigger
 * one calendar fetch, not N of them.
 *
 * This only dedups within a single running process/instance, not globally —
 * a serverless deployment with multiple warm instances can still fire one
 * fetch per instance. That is an accepted, honest limitation, not a bug:
 * closing it fully needs a distributed lock, which is out of scope here.
 */
const inFlightSyncs = new Map<string, Promise<void>>();

/**
 * Refreshes a member's cached busy intervals, wrapping `replaceBusyForMember`
 * with the concurrency and failure-safety rules a calendar sync needs:
 *
 * - **Timeout.** `fetchIntervals` is given an `AbortSignal` that fires after
 *   `ICS_FETCH_TIMEOUT_MS`. Callers must pass it to their fetch so a dead
 *   host cannot hang a page render.
 * - **Serve last-known-good on failure.** If `fetchIntervals` throws for any
 *   reason — including the timeout, which is a failure here, not "no
 *   events" — the existing cached `busy` rows are left untouched and the
 *   rejection propagates to the caller to handle (e.g. show a stale-data
 *   note). `replaceBusyForMember` is only ever called on success.
 * - **Single-flight per member.** Concurrent calls for the same `memberId`
 *   share one in-flight fetch rather than issuing redundant requests.
 *
 * `fetchIntervals` is supplied by the caller (the actual `.ics` fetch and
 * parse live outside this module's ownership); this function owns only the
 * cache-safety boundary around it.
 */
export async function syncMemberBusy(
  memberId: string,
  fetchIntervals: (signal: AbortSignal) => Promise<{ start: number; end: number }[]>,
  source: string,
): Promise<void> {
  const existing = inFlightSyncs.get(memberId);
  if (existing) return existing;

  const run = (async () => {
    try {
      const signal = AbortSignal.timeout(ICS_FETCH_TIMEOUT_MS);
      const intervals = await fetchIntervals(signal);
      await replaceBusyForMember(memberId, intervals, source);
    } finally {
      inFlightSyncs.delete(memberId);
    }
  })();

  inFlightSyncs.set(memberId, run);
  return run;
}

/**
 * Allocates the next unused two-letter tag + tint pair for a circle, cycling
 * back to the start of `TAG_PALETTE` if the circle somehow outgrows it rather
 * than throwing — a seventh member should still get a (reused) tag, not a
 * broken join flow.
 */
export async function assignNextTagAndColor(circleId: string): Promise<{ tag: string; color: string }> {
  const existing = await db.query.member.findMany({
    where: eq(member.circleId, circleId),
    columns: { tag: true },
  });
  const usedTags = new Set(existing.map((m) => m.tag));
  const next = TAG_PALETTE.find((entry) => !usedTags.has(entry.tag));
  return next ?? TAG_PALETTE[existing.length % TAG_PALETTE.length]!;
}


/**
 * Record the time a circle agreed on, so the decision is visible to everyone
 * holding the link rather than living in one person's downloads folder.
 *
 * `memberId` is verified to belong to this circle by the caller (it comes from
 * a cookie), and stored only for attribution — anyone in the circle may change
 * the choice, because a group of three co-founders does not need a permissions
 * model, and one would be the wrong answer to a social problem.
 */
export async function setChosenSlot(
  circleId: string,
  memberId: string | null,
  start: number,
  end: number,
): Promise<void> {
  assertId(circleId, 'circleId');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error(`Invalid chosen slot: ${start}..${end}`);
  }
  await db
    .update(circle)
    .set({ chosenStart: start, chosenEnd: end, chosenBy: memberId, chosenAt: new Date() })
    .where(eq(circle.id, circleId));
}

/** Un-decide. Returns the circle to "no time agreed yet". */
export async function clearChosenSlot(circleId: string): Promise<void> {
  assertId(circleId, 'circleId');
  await db
    .update(circle)
    .set({ chosenStart: null, chosenEnd: null, chosenBy: null, chosenAt: null })
    .where(eq(circle.id, circleId));
}


/**
 * Store a member's Google refresh token, encrypted at rest.
 *
 * Google is stored alongside, not instead of, any iCal URL: a member who
 * connects Google keeps whatever they pasted before, so disconnecting Google
 * falls back rather than leaving them with nothing.
 */
export async function setGoogleRefreshToken(memberId: string, refreshToken: string): Promise<void> {
  assertId(memberId, 'memberId');
  if (!refreshToken) throw new Error('Refusing to store an empty Google refresh token.');
  await db
    .update(member)
    .set({ googleRefreshTokenEncrypted: encrypt(refreshToken) })
    .where(eq(member.id, memberId));
}

/** Decrypts on demand, for the sync path only. Never returned to a client. */
export async function getGoogleRefreshToken(memberId: string): Promise<string | null> {
  assertId(memberId, 'memberId');
  const row = await db.query.member.findFirst({ where: eq(member.id, memberId) });
  if (!row?.googleRefreshTokenEncrypted) return null;
  try {
    return decrypt(row.googleRefreshTokenEncrypted);
  } catch {
    // A token we cannot decrypt (rotated key, corrupted row) is unusable. Fail
    // as "not connected" rather than throwing into a page render; the member
    // can reconnect, and the sync path keeps the last known good busy rows.
    return null;
  }
}

export async function clearGoogleRefreshToken(memberId: string): Promise<void> {
  assertId(memberId, 'memberId');
  await db
    .update(member)
    .set({ googleRefreshTokenEncrypted: null })
    .where(eq(member.id, memberId));
}
