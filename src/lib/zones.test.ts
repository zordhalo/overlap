import { describe, expect, it } from 'vitest';
import { groupedZones, isValidTimezone, zoneInfo } from './zones';

describe('zoneInfo', () => {
  it('returns curated coordinates for a known zone', () => {
    const info = zoneInfo('America/Toronto');
    expect(info.label).toBe('Toronto');
    expect(info.lat).toBeCloseTo(43.65, 1);
    expect(info.lng).toBeCloseTo(-79.38, 1);
  });

  it('derives an offset-based longitude in range for an obscure-but-real zone', () => {
    // Not in the curated table, but a genuine IANA zone (UTC+9:30).
    const info = zoneInfo('Australia/Darwin');
    expect(info.lat).toBe(0);
    expect(info.lng).toBeGreaterThanOrEqual(-180);
    expect(info.lng).toBeLessThanOrEqual(180);
    // 9.5h east of UTC -> roughly 142.5deg longitude.
    expect(info.lng).toBeCloseTo(142.5, 0);
  });

  it('rejects an invalid zone', () => {
    expect(() => zoneInfo('Not/AZone')).toThrow();
    expect(isValidTimezone('Not/AZone')).toBe(false);
  });

  it('validates a real zone', () => {
    expect(isValidTimezone('Europe/London')).toBe(true);
  });
});

describe('groupedZones', () => {
  it('groups curated zones by region with value/label pairs', () => {
    const groups = groupedZones();
    expect(groups.length).toBeGreaterThan(0);
    const america = groups.find((g) => g.region === 'America');
    expect(america).toBeDefined();
    expect(america?.zones.some((z) => z.value === 'America/Toronto' && z.label === 'Toronto')).toBe(
      true,
    );
  });
});

describe('deprecated zone aliases', () => {
  it('places a deprecated alias at its canonical coordinates, not at latitude 0', () => {
    // Asia/Calcutta is what several runtimes still resolve to — including
    // Intl.supportedValuesOf itself. Missing the curated table sent the marker
    // to lat 0, which is the Indian Ocean rather than India.
    const canonical = zoneInfo('Asia/Kolkata');
    const alias = zoneInfo('Asia/Calcutta');
    expect(alias.lat).toBeCloseTo(canonical.lat, 5);
    expect(alias.lng).toBeCloseTo(canonical.lng, 5);
    expect(alias.lat).not.toBe(0);
  });

  it.each([
    ['Europe/Kiev', 'Europe/Kyiv'],
    ['US/Eastern', 'America/New_York'],
    ['America/Indianapolis', 'America/Indiana/Indianapolis'],
  ])('maps %s onto %s coordinates', (alias, canonical) => {
    expect(zoneInfo(alias).lat).toBeCloseTo(zoneInfo(canonical).lat, 5);
  });
});
