/**
 * Drizzle schema for Overlap. This is the only file that declares table
 * shape; every other module reaches the database through `queries.ts`, never
 * through this file directly.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  doublePrecision,
  bigint,
  boolean,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * A circle is a standing group with a share link. `slug` is a capability
 * URL — possession of the link is the only authorisation, so it is a random
 * nanoid, never derived from `name`, and there is no query anywhere that
 * lists circles or lets one be enumerated.
 */
export const circle = pgTable('circle', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  durationMinutes: integer('duration_minutes').notNull(),
  horizonDays: integer('horizon_days').notNull(),
  /**
   * The time the circle agreed on, if any. Epoch ms.
   *
   * This lives on the circle rather than on a member deliberately: a decision
   * that only one person can see is not a decision, and picking a slot used to
   * produce nothing but a private calendar file — leaving the group to settle
   * "so, Tuesday 3pm?" in chat, which is exactly the negotiation this product
   * exists to end.
   */
  chosenStart: bigint('chosen_start', { mode: 'number' }),
  chosenEnd: bigint('chosen_end', { mode: 'number' }),
  chosenBy: uuid('chosen_by'),
  chosenAt: timestamp('chosen_at', { withTimezone: true }),
  /**
   * The Google Calendar invite that went out to the circle, if one did.
   *
   * Picking a time is a proposal anyone can change with a click; sending the
   * invite is the commitment, and it lives on ONE member's calendar (the
   * organizer's). Remembering which event and whose calendar is what lets a
   * later change of time move that same invite, so everyone gets "updated"
   * rather than a second meeting stacked beside the first.
   *
   * `inviteStart`/`inviteEnd` are the time the invite currently says, which
   * can differ from `chosenStart` while someone is looking at alternatives.
   */
  inviteEventId: text('invite_event_id'),
  inviteOrganizerId: uuid('invite_organizer_id'),
  inviteStart: bigint('invite_start', { mode: 'number' }),
  inviteEnd: bigint('invite_end', { mode: 'number' }),
}, (t) => [
  uniqueIndex('circle_slug_idx').on(t.slug),
  check('circle_duration_positive', sql`${t.durationMinutes} > 0 AND ${t.durationMinutes} <= 1440`),
  check('circle_horizon_positive', sql`${t.horizonDays} > 0 AND ${t.horizonDays} <= 365`),
]);

/**
 * `sleepStart`/`sleepEnd`/`workStart`/`workEnd` are local minutes-from-midnight,
 * 0..1439. `sleepStart > sleepEnd` is legal and normal (22:00 -> 07:00);
 * nothing here or downstream may assume ordering.
 *
 * `icsUrlEncrypted` holds an AES-256-GCM ciphertext (see `../crypto.ts`), not
 * a URL. The plaintext iCal URL is a bearer credential to someone's whole
 * calendar, so it is never stored, logged, or returned unencrypted.
 *
 * There is deliberately no `summary`/description column anywhere member data
 * lives — see `busy` below for why that matters more there.
 */
export const member = pgTable('member', {
  id: uuid('id').primaryKey().defaultRandom(),
  circleId: uuid('circle_id').notNull().references(() => circle.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  sleepStart: integer('sleep_start').notNull(),
  sleepEnd: integer('sleep_end').notNull(),
  workStart: integer('work_start').notNull(),
  workEnd: integer('work_end').notNull(),
  icsUrlEncrypted: text('ics_url_encrypted'),
  /**
   * Google refresh token, encrypted at rest exactly like the iCal URL.
   *
   * Kept separate rather than overloading the iCal column: a member may switch
   * between the two, and a single column would make "disconnect Google" and
   * "clear my iCal URL" the same destructive operation.
   */
  googleRefreshTokenEncrypted: text('google_refresh_token_encrypted'),
  /**
   * Optional recovery address, encrypted at rest like every other secret here.
   *
   * Overlap's security model is the capability URL: holding the link is the
   * whole authorisation. Recovery is, unavoidably, a second way in — so the
   * thing guarding it has to be something only the right person holds, and
   * inbox access is the well-understood answer. It stays opt-in, because
   * "no account" remains true for anyone who skips it.
   */
  emailEncrypted: text('email_encrypted'),
  /**
   * HMAC of the normalised address, for lookup only.
   *
   * Recovery has to find members by address, and AES-GCM is deterministically
   * unsearchable by design (fresh IV per record, so the same email encrypts
   * differently every time). A keyed hash gives an index without ever storing
   * or scanning a plaintext address — and being keyed, not plain SHA-256, it
   * cannot be attacked with a dictionary of common addresses if the table
   * leaks without the key.
   */
  emailHash: text('email_hash'),
  /**
   * Whether the address above may be put on the circle's calendar invite.
   *
   * Separate from having an address at all: the address was first collected
   * for recovery only, with a promise it would never be shown to the circle,
   * and a Google invite shows every guest's address to every other guest.
   * So it is an explicit opt-in, and rows from before it existed stay out.
   */
  invitesOptIn: boolean('invites_opt_in').notNull().default(false),
  tag: text('tag').notNull(),
  color: text('color').notNull(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('member_sleep_start_range', sql`${t.sleepStart} >= 0 AND ${t.sleepStart} <= 1439`),
  check('member_sleep_end_range', sql`${t.sleepEnd} >= 0 AND ${t.sleepEnd} <= 1439`),
  check('member_work_start_range', sql`${t.workStart} >= 0 AND ${t.workStart} <= 1439`),
  check('member_work_end_range', sql`${t.workEnd} >= 0 AND ${t.workEnd} <= 1439`),
  index('member_email_hash_idx').on(t.emailHash),
]);

/**
 * `busy` is a cache of calendar data, refreshed when `syncedAt` is older than
 * `BUSY_CACHE_TTL_MS` (see `queries.ts`).
 *
 * There is intentionally NO `summary`/title column. Overlap only ever needs
 * to know *that* a member is busy, never *what* they are doing — a column
 * that does not exist cannot leak one co-founder's meeting title to another
 * member of the circle, whatever a future caller asks for.
 */
export const busy = pgTable('busy', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('busy_interval_order', sql`${t.endsAt} > ${t.startsAt}`),
]);


/**
 * Throttling for the recovery endpoint.
 *
 * Recovery sends mail to an address the requester names, which makes it the
 * one route in this app that can be turned into a weapon: unthrottled, anyone
 * could use it to mail-bomb a known address, or to burn the sending
 * reputation of a domain shared with the rest of the business.
 *
 * Rows are keyed by either the address hash or the caller's IP, and are
 * counted within a window rather than updated, so a burst cannot be hidden by
 * a single row being rewritten.
 */
export const recoveryAttempt = pgTable('recovery_attempt', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Either `hash:<emailHash>` or `ip:<address>`. Never a plaintext address. */
  subject: text('subject').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('recovery_attempt_subject_idx').on(t.subject, t.createdAt),
]);
