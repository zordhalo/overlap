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
