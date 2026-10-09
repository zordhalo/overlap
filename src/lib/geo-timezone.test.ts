import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectByLocation, timezoneFromCoords } from './geo-timezone';

/** Offset in minutes at a fixed instant, so a zone assertion can also assert
 *  the thing that actually matters to a meeting: what the clock reads. */
function offsetMinutes(zone: string, at = Date.UTC(2026, 9, 9, 13, 0, 0)): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    hour12: false,
  }).format(at);
  return (Number(formatted) - 13) * 60;
}

describe('timezoneFromCoords', () => {
  it('resolves the two zones this feature exists to tell apart', () => {
    // The bug that prompted this: a member on GMT+3 stored as GMT+5. Two
    // hours is the whole difference between a 16:00 call and an 18:00 one.
    expect(timezoneFromCoords(24.71, 46.68)).toBe('Asia/Riyadh');
    expect(timezoneFromCoords(24.86, 67.0)).toBe('Asia/Karachi');
    expect(offsetMinutes('Asia/Riyadh')).toBe(180);
    expect(offsetMinutes('Asia/Karachi')).toBe(300);
  });

  it('resolves a zone that observes DST', () => {
    expect(timezoneFromCoords(43.65, -79.38)).toBe('America/Toronto');
  });

  it('returns a zone the rest of the app will accept', () => {
    // Anything this produces flows into the same `<select>` and the same
    // server-side `isValidTimezone` gate as a hand-picked zone.
    for (const [lat, lng] of [
      [51.51, -0.13],
      [-33.87, 151.21],
      [35.68, 139.69],
      [0, 0],
    ] as const) {
      const zone = timezoneFromCoords(lat, lng);
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone })).not.toThrow();
    }
  });

  it('rejects coordinates that are not coordinates', () => {
    expect(() => timezoneFromCoords(Number.NaN, 0)).toThrow();
    expect(() => timezoneFromCoords(91, 0)).toThrow();
    expect(() => timezoneFromCoords(0, 181)).toThrow();
  });
});

/** Installs a fake `navigator.geolocation` for one test. Omitting the
 *  callback stands for a browser with no geolocation at all. */
function stubGeolocation(impl: {
  getCurrentPosition?: (ok: PositionCallback, fail: PositionErrorCallback) => void;
}) {
  vi.stubGlobal(
    'navigator',
    impl.getCurrentPosition ? { geolocation: { getCurrentPosition: impl.getCurrentPosition } } : {},
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectByLocation', () => {
  it('resolves a zone when the browser hands back a position', async () => {
    stubGeolocation({
      getCurrentPosition: (ok) =>
        ok({ coords: { latitude: 24.71, longitude: 46.68 } } as GeolocationPosition),
    });
    await expect(detectByLocation()).resolves.toEqual({ zone: 'Asia/Riyadh' });
  });

  it('reports a refusal as denied rather than throwing', async () => {
    stubGeolocation({
      getCurrentPosition: (_ok, fail) =>
        fail({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError),
    });
    await expect(detectByLocation()).resolves.toEqual({ error: 'denied' });
  });

  it('distinguishes a timeout from a position that is simply unavailable', async () => {
    stubGeolocation({
      getCurrentPosition: (_ok, fail) => fail({ code: 3, message: 'Timeout' } as GeolocationPositionError),
    });
    await expect(detectByLocation()).resolves.toEqual({ error: 'timeout' });

    stubGeolocation({
      getCurrentPosition: (_ok, fail) =>
        fail({ code: 2, message: 'Position unavailable' } as GeolocationPositionError),
    });
    await expect(detectByLocation()).resolves.toEqual({ error: 'unavailable' });
  });

  it('reports unavailable when the browser has no geolocation at all', async () => {
    stubGeolocation({});
    await expect(detectByLocation()).resolves.toEqual({ error: 'unavailable' });
  });

  it('treats a position outside the lookup table as unavailable, not a crash', async () => {
    stubGeolocation({
      getCurrentPosition: (ok) =>
        ok({ coords: { latitude: Number.NaN, longitude: Number.NaN } } as GeolocationPosition),
    });
    await expect(detectByLocation()).resolves.toEqual({ error: 'unavailable' });
  });
});
