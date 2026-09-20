/**
 * Shared test fixtures. Not exported from the barrel — this file exists only
 * to keep the *.test.ts files from repeating the same member boilerplate.
 */
import { DateTime } from 'luxon';
import type { Member } from './types';

/** Build an absolute epoch-ms instant from local wall-clock components in `zone`. */
export function localMs(zone: string, year: number, month: number, day: number, hour: number, minute = 0): number {
  const dt = DateTime.fromObject({ year, month, day, hour, minute }, { zone });
  return dt.toMillis();
}

export function makeMember(overrides: Partial<Member> & Pick<Member, 'id' | 'timezone'>): Member {
  return {
    name: overrides.id,
    sleepStart: 1320, // 22:00
    sleepEnd: 420, // 07:00
    workStart: 540, // 09:00
    workEnd: 1020, // 17:00
    busy: [],
    tag: overrides.id.slice(0, 2).toUpperCase(),
    color: '#7fb2ff',
    lat: null,
    lng: null,
    ...overrides,
  };
}
