/**
 * Example circle for the landing page.
 *
 * Deliberately real data through the real engine, not a mockup: the landing
 * page renders the same Globe, Timeline and Slots components the product uses,
 * fed by `suggest()`. A screenshot-style fake would drift from the product the
 * first time either changed, and would be a claim we could not stand behind.
 *
 * The zones are chosen to produce a MIXED result, not just a valid one.
 *
 * Toronto, London and Bengaluru share a real but narrow window: 09:00 in
 * Toronto is 14:00 in London and 18:30 in Bengaluru, inside everyone's working
 * day. An hour later it runs past Ravi's, and no longer is.
 *
 * Ravi's day runs to 20:00 rather than 19:00 for a reason worth stating: the
 * meeting is 45 minutes, so a 09:00 Toronto start ENDS at 19:15 his time. At a
 * 19:00 finish every single option came out amber and the demo showed a colour
 * scale with one colour on it. Slots are scored on the whole meeting, not on
 * when it starts. So the picker
 * shows a couple of genuinely clean options and then several that cost
 * somebody something — which is the whole point of colouring them differently,
 * and what an all-costly or all-clean demo fails to show.
 *
 * An earlier version paired Toronto with Tokyo, whose thirteen-hour gap leaves
 * no clean slot at all: every chip came out amber and the day groups held one
 * option each, so the demo demonstrated the product's worst case.
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
    id: 'demo-noor',
    name: 'Noor',
    tag: 'BR',
    color: '#c9a227',
    timezone: 'Europe/London',
    sleepStart: 23 * 60,
    sleepEnd: 6 * 60 + 30,
    workStart: 9 * 60,
    workEnd: 18 * 60,
    busyBlocks: [[16, 2]],
  },
  {
    id: 'demo-ravi',
    name: 'Ravi',
    tag: 'MT',
    color: '#8fd9c0',
    timezone: 'Asia/Kolkata',
    sleepStart: 0,
    sleepEnd: 7 * 60 + 30,
    workStart: 10 * 60,
    workEnd: 20 * 60,
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
