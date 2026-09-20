/**
 * Example circle for the landing page.
 *
 * Deliberately real data through the real engine, not a mockup: the landing
 * page renders the same Globe, Timeline and Slots components the product uses,
 * fed by `suggest()`. A screenshot-style fake would drift from the product the
 * first time either changed, and would be a claim we could not stand behind.
 *
 * The people are labelled examples. Their zones are chosen to produce a narrow,
 * interesting overlap rather than a trivial one: Toronto and Berlin share a
 * workday edge, and Tokyo only reaches both late in its evening.
 */

import type { Member } from '@/lib/schedule/types';
import { zoneInfo } from '@/lib/zones';

const HOUR = 60 * 60 * 1000;

type Seed = {
  id: string;
  name: string;
  tag: string;
  color: string;
  timezone: string;
  sleepStart: number;
  sleepEnd: number;
  workStart: number;
  workEnd: number;
  /** Busy blocks as [hoursFromWindowStart, durationHours], so the hatched
   *  calendar band is visible without needing a database. */
  busyBlocks: [number, number][];
};

const SEEDS: Seed[] = [
  {
    id: 'demo-ama',
    name: 'Ama',
    tag: 'IC',
    color: '#7fb2ff',
    timezone: 'America/Toronto',
    sleepStart: 23 * 60 + 30,
    sleepEnd: 7 * 60,
    workStart: 9 * 60,
    workEnd: 17 * 60,
    busyBlocks: [
      [14, 1],
      [20, 1.5],
    ],
  },
  {
    id: 'demo-jonas',
    name: 'Jonas',
    tag: 'BR',
    color: '#c9a227',
    timezone: 'Europe/Berlin',
    sleepStart: 23 * 60,
    sleepEnd: 6 * 60 + 30,
    workStart: 9 * 60,
    workEnd: 18 * 60,
    busyBlocks: [[16, 2]],
  },
  {
    id: 'demo-rin',
    name: 'Rin',
    tag: 'MT',
    color: '#8fd9c0',
    timezone: 'Asia/Tokyo',
    sleepStart: 0,
    sleepEnd: 7 * 60 + 30,
    workStart: 10 * 60,
    workEnd: 19 * 60,
    busyBlocks: [[11, 1]],
  },
];

export function demoMembers(from: number): Member[] {
  return SEEDS.map((seed) => {
    const { lat, lng } = zoneInfo(seed.timezone);
    return {
      id: seed.id,
      name: seed.name,
      timezone: seed.timezone,
      sleepStart: seed.sleepStart,
      sleepEnd: seed.sleepEnd,
      workStart: seed.workStart,
      workEnd: seed.workEnd,
      tag: seed.tag,
      color: seed.color,
      lat,
      lng,
      busy: seed.busyBlocks.map(([offsetHours, durationHours]) => ({
        start: from + offsetHours * HOUR,
        end: from + (offsetHours + durationHours) * HOUR,
      })),
    };
  });
}
