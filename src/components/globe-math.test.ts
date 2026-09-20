import { describe, expect, it } from 'vitest';
import { isDaylight, phiForLongitude, subsolarLongitude } from './globe-math';

describe('subsolarLongitude', () => {
  it('is near 0 at 12:00 UTC (mean solar noon at the prime meridian)', () => {
    const noon = Date.UTC(2024, 0, 1, 12, 0, 0);
    expect(subsolarLongitude(noon)).toBeCloseTo(0, 0); // within ~1° (equation-of-time slack)
  });

  it('is near ±180 at 00:00 UTC (antimeridian faces the sun)', () => {
    const midnight = Date.UTC(2024, 0, 1, 0, 0, 0);
    expect(Math.abs(subsolarLongitude(midnight))).toBeCloseTo(180, 0);
  });

  it('moves ~15°/hour westward (negative) away from the ±180 wrap seam', () => {
    // Pick a window nowhere near the ±180 discontinuity (06:00-07:00 UTC ->
    // subsolar longitude ~90° -> ~75°) so a plain subtraction is valid.
    const t0 = Date.UTC(2024, 5, 1, 6, 0, 0);
    const t1 = Date.UTC(2024, 5, 1, 7, 0, 0);
    const delta = subsolarLongitude(t1) - subsolarLongitude(t0);
    expect(delta).toBeCloseTo(-15, 0);
  });
});

describe('isDaylight', () => {
  // London: real IANA rules put it at UTC+1 (BST) in July, but that is a
  // political/legal convention, not a solar one — isDaylight only knows
  // (lat, lng), so "local solar noon" for a place near the prime meridian is
  // simply UTC 12:00, independent of what a clock on a wall there reads.
  const LONDON_LAT = 51.5074;
  const LONDON_LNG = -0.1278;

  it('is daylight at London\'s solar noon in July (near-solstice declination)', () => {
    const solarNoonJuly = Date.UTC(2024, 6, 15, 12, 0, 0);
    expect(isDaylight(LONDON_LAT, LONDON_LNG, solarNoonJuly)).toBe(true);
  });

  it('is not daylight at London\'s solar midnight in July', () => {
    const solarMidnightJuly = Date.UTC(2024, 6, 15, 0, 0, 0);
    expect(isDaylight(LONDON_LAT, LONDON_LNG, solarMidnightJuly)).toBe(false);
  });

  it('is not daylight at London\'s solar midnight in December', () => {
    const solarMidnightDecember = Date.UTC(2024, 11, 15, 0, 0, 0);
    expect(isDaylight(LONDON_LAT, LONDON_LNG, solarMidnightDecember)).toBe(false);
  });
});

describe('phiForLongitude', () => {
  /**
   * Re-derivation of cobe 2.0.1's own coordinate + projection math (see the
   * long comment on `phiForLongitude` for where these three lines come
   * from), so this test verifies against cobe's actual convention rather
   * than against `phiForLongitude`'s own reasoning circularly.
   */
  function cobeUnitVector(lat: number, lng: number): [number, number, number] {
    const r = (lat * Math.PI) / 180;
    const a = (lng * Math.PI) / 180 - Math.PI;
    const o = Math.cos(r);
    return [-o * Math.cos(a), Math.sin(r), o * Math.sin(a)];
  }

  function screenAndFacing(
    point: [number, number, number],
    phi: number,
    theta: number,
  ): { c: number; s: number; frontFacing: number } {
    const [x, y, z] = point;
    const r = Math.cos(theta);
    const a = Math.cos(phi);
    const o = Math.sin(theta);
    const i = Math.sin(phi);
    const c = a * x + i * z;
    const s = i * o * x + r * y - a * o * z;
    const frontFacing = -i * r * x + o * y + a * r * z;
    return { c, s, frontFacing };
  }

  it.each([-150, -90, -45, 0, 30, 90, 135, 179])(
    'centers longitude %d° on screen and faces the viewer at theta=0',
    (lng) => {
      const phi = phiForLongitude(lng);
      const point = cobeUnitVector(0, lng); // equatorial point at this longitude
      const { c, s, frontFacing } = screenAndFacing(point, phi, 0);
      expect(c).toBeCloseTo(0, 5);
      expect(s).toBeCloseTo(0, 5);
      expect(frontFacing).toBeCloseTo(1, 5); // dead center of the visible disc
    },
  );
});
