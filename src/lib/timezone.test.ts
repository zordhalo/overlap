import { describe, expect, it } from 'vitest';
import { isValidTimezone, assertValidTimezone, selectableTimezones } from './timezone';

describe('isValidTimezone', () => {
  // The regression this module exists for. Each of these is a real zone that
  // Intl.supportedValuesOf omits, so a membership check would reject a real
  // person trying to join.
  it.each([
    'Asia/Kolkata',
    'Europe/Kyiv',
    'Asia/Kathmandu',
    'America/Indiana/Indianapolis',
  ])('accepts %s, which Intl.supportedValuesOf omits', (zone) => {
    expect(Intl.supportedValuesOf('timeZone')).not.toContain(zone);
    expect(isValidTimezone(zone)).toBe(true);
  });

  it.each(['America/Toronto', 'Europe/London', 'UTC', 'Asia/Calcutta'])(
    'accepts %s',
    (zone) => expect(isValidTimezone(zone)).toBe(true),
  );

  it.each(['', 'Not/AZone', 'Toronto', '+05:30', 'en-US', '../etc/passwd'])(
    'rejects %s',
    (zone) => expect(isValidTimezone(zone)).toBe(false),
  );

  it.each([null, undefined, 42, {}, []])('rejects non-string %s', (v) =>
    expect(isValidTimezone(v)).toBe(false),
  );

  it('throws with the offending value named', () => {
    expect(() => assertValidTimezone('Nope/Nope', 'memberTimezone')).toThrow(/memberTimezone/);
  });
});

describe('selectableTimezones', () => {
  it('includes the canonical names Intl omits, and stays sorted and unique', () => {
    const zones = selectableTimezones();
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).toContain('Europe/Kyiv');
    expect(zones.length).toBeGreaterThan(Intl.supportedValuesOf('timeZone').length);
    expect(new Set(zones).size).toBe(zones.length);
    expect([...zones].sort()).toEqual(zones);
  });

  it('offers only zones that actually resolve', () => {
    for (const z of selectableTimezones()) expect(isValidTimezone(z)).toBe(true);
  });
});
