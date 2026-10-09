/**
 * Resolving a timezone from where the device actually is.
 *
 * The device clock is the only signal Overlap had, and it is the one signal
 * that cannot catch its own mistake: a browser in Toronto with its OS set to
 * Karachi reports Karachi, confidently, forever. Every suggested time for
 * that member is then scored against a clock two hours from the one they
 * read. Satellite and wifi positioning do not share that failure mode, so
 * they are worth asking for — as a second opinion, never as an override.
 *
 * Nothing here runs on the server and no coordinate ever leaves the browser:
 * the lookup table ships to the client and the only value that reaches
 * `joinCircleAction` is an IANA zone string, the same kind of value the
 * `<select>` has always posted. That is what keeps the privacy page's
 * "we do not collect your device location" true.
 */

import tzLookup from '@photostructure/tz-lookup';
import { isValidTimezone } from './zones';

/** How long to wait for a fix before giving up and leaving the device clock
 *  in place. Long enough for a cold GPS start on a phone, short enough that
 *  the form never feels stuck — the field is already filled in meanwhile. */
const POSITION_TIMEOUT_MS = 10_000;

/**
 * A cached fix up to five minutes old is accepted. Timezone boundaries are
 * tens of kilometres apart at their closest; nobody crosses one in the time
 * it takes a stale reading to matter, and reusing one avoids a second
 * hardware wake-up when a member edits their hours right after joining.
 */
const MAX_POSITION_AGE_MS = 5 * 60 * 1000;

export type LocationFailure = 'denied' | 'unavailable' | 'timeout';

export type LocationZone = { zone: string } | { error: LocationFailure };

/**
 * The IANA zone covering a point.
 *
 * Throws on coordinates that are not coordinates, which is the library's own
 * contract and worth preserving: a NaN reaching the form as a silent "UTC"
 * would be the device-clock bug all over again, in a new disguise.
 */
export function timezoneFromCoords(latitude: number, longitude: number): string {
  const zone = tzLookup(latitude, longitude);
  // The table is lossy by design (see the package README), so treat its
  // output as untrusted input rather than assuming every cell holds a zone
  // this runtime can resolve.
  if (!isValidTimezone(zone)) {
    throw new Error(`Location resolved to an unusable zone: ${JSON.stringify(zone)}`);
  }
  return zone;
}

/** Maps a `GeolocationPositionError` code to the three outcomes the form
 *  distinguishes. Codes are 1/2/3 per the spec; anything else is treated as
 *  a plain failure rather than assumed to be a refusal. */
function failureFor(code: number): LocationFailure {
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

/**
 * Ask the browser where it is and turn that into a zone.
 *
 * Never rejects. Every outcome a caller can do something different about is
 * a value, because the one thing this must not do is break the join form:
 * a member who refuses, or whose browser has no geolocation at all, still
 * has a working timezone picker underneath.
 *
 * Calling this is what triggers the browser's permission prompt, if the
 * browser is willing to show one. It cannot be forced: a grant or a refusal
 * is remembered by the browser, and no site API can reset it.
 */
export function detectByLocation(): Promise<LocationZone> {
  const geolocation = globalThis.navigator?.geolocation;
  if (!geolocation) return Promise.resolve({ error: 'unavailable' });

  return new Promise<LocationZone>((resolve) => {
    geolocation.getCurrentPosition(
      (position) => {
        try {
          resolve({ zone: timezoneFromCoords(position.coords.latitude, position.coords.longitude) });
        } catch {
          // A fix we cannot turn into a zone is no better than no fix.
          resolve({ error: 'unavailable' });
        }
      },
      (error) => resolve({ error: failureFor(error.code) }),
      {
        timeout: POSITION_TIMEOUT_MS,
        maximumAge: MAX_POSITION_AGE_MS,
        // City-level accuracy decides a timezone. Asking for a precise fix
        // would wake the GPS, cost battery, and buy nothing.
        enableHighAccuracy: false,
      },
    );
  });
}
