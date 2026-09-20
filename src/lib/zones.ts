import { isValidTimezone as canResolveTimezone, selectableTimezones } from './timezone';
/**
 * IANA timezone -> approximate coordinates, for the globe.
 *
 * The globe needs a lat/lng per member. A curated table covers the zones
 * people actually pick (major cities, one per zone in common use); anything
 * outside it falls back to a longitude derived from the zone's current UTC
 * offset (`offsetMinutes / 60 * 15`) and latitude 0. That puts an unlisted
 * zone at roughly the right place on the globe instead of nowhere at all —
 * "approximately correct" beats "silently missing."
 *
 * Coordinates here are city-approximate, not exact — good enough for a
 * globe marker, not a geocoder.
 */

type ZoneEntry = { label: string; lat: number; lng: number };

/**
 * Curated common zones, grouped by region for `groupedZones()`. Deliberately
 * not exhaustive — `selectableTimezones()` has ~400 entries and
 * most name obscure islands or historical aliases nobody picks from a
 * `<select>`. Region grouping here doubles as the `<optgroup>` structure.
 */
const REGIONS: { region: string; zones: Record<string, ZoneEntry> }[] = [
  {
    region: 'Africa',
    zones: {
      'Africa/Cairo': { label: 'Cairo', lat: 30.04, lng: 31.24 },
      'Africa/Casablanca': { label: 'Casablanca', lat: 33.57, lng: -7.59 },
      'Africa/Johannesburg': { label: 'Johannesburg', lat: -26.2, lng: 28.05 },
      'Africa/Lagos': { label: 'Lagos', lat: 6.52, lng: 3.38 },
      'Africa/Nairobi': { label: 'Nairobi', lat: -1.29, lng: 36.82 },
      'Africa/Tunis': { label: 'Tunis', lat: 36.81, lng: 10.18 },
    },
  },
  {
    region: 'America',
    zones: {
      'America/Anchorage': { label: 'Anchorage', lat: 61.22, lng: -149.9 },
      'America/Argentina/Buenos_Aires': { label: 'Buenos Aires', lat: -34.6, lng: -58.38 },
      'America/Bogota': { label: 'Bogotá', lat: 4.71, lng: -74.07 },
      'America/Chicago': { label: 'Chicago', lat: 41.88, lng: -87.63 },
      'America/Denver': { label: 'Denver', lat: 39.74, lng: -104.99 },
      'America/Halifax': { label: 'Halifax', lat: 44.65, lng: -63.57 },
      'America/Lima': { label: 'Lima', lat: -12.05, lng: -77.04 },
      'America/Los_Angeles': { label: 'Los Angeles', lat: 34.05, lng: -118.24 },
      'America/Mexico_City': { label: 'Mexico City', lat: 19.43, lng: -99.13 },
      'America/New_York': { label: 'New York', lat: 40.71, lng: -74.01 },
      'America/Phoenix': { label: 'Phoenix', lat: 33.45, lng: -112.07 },
      'America/Santiago': { label: 'Santiago', lat: -33.45, lng: -70.65 },
      'America/Sao_Paulo': { label: 'São Paulo', lat: -23.55, lng: -46.63 },
      'America/St_Johns': { label: "St. John's", lat: 47.56, lng: -52.71 },
      'America/Toronto': { label: 'Toronto', lat: 43.65, lng: -79.38 },
      'America/Vancouver': { label: 'Vancouver', lat: 49.28, lng: -123.12 },
      'America/Winnipeg': { label: 'Winnipeg', lat: 49.9, lng: -97.14 },
    },
  },
  {
    region: 'Asia',
    zones: {
      'Asia/Bangkok': { label: 'Bangkok', lat: 13.76, lng: 100.5 },
      'Asia/Dhaka': { label: 'Dhaka', lat: 23.81, lng: 90.41 },
      'Asia/Dubai': { label: 'Dubai', lat: 25.2, lng: 55.27 },
      'Asia/Hong_Kong': { label: 'Hong Kong', lat: 22.32, lng: 114.17 },
      'Asia/Jakarta': { label: 'Jakarta', lat: -6.21, lng: 106.85 },
      'Asia/Jerusalem': { label: 'Jerusalem', lat: 31.77, lng: 35.21 },
      'Asia/Kabul': { label: 'Kabul', lat: 34.56, lng: 69.21 },
      'Asia/Karachi': { label: 'Karachi', lat: 24.86, lng: 67.0 },
      'Asia/Kathmandu': { label: 'Kathmandu', lat: 27.72, lng: 85.32 },
      'Asia/Kolkata': { label: 'Mumbai / Delhi', lat: 19.08, lng: 72.88 },
      'Asia/Manila': { label: 'Manila', lat: 14.6, lng: 120.98 },
      'Asia/Riyadh': { label: 'Riyadh', lat: 24.71, lng: 46.68 },
      'Asia/Seoul': { label: 'Seoul', lat: 37.57, lng: 126.98 },
      'Asia/Shanghai': { label: 'Shanghai / Beijing', lat: 31.23, lng: 121.47 },
      'Asia/Singapore': { label: 'Singapore', lat: 1.35, lng: 103.82 },
      'Asia/Taipei': { label: 'Taipei', lat: 25.03, lng: 121.57 },
      'Asia/Tehran': { label: 'Tehran', lat: 35.69, lng: 51.39 },
      'Asia/Tokyo': { label: 'Tokyo', lat: 35.68, lng: 139.65 },
    },
  },
  {
    region: 'Atlantic',
    zones: {
      'Atlantic/Azores': { label: 'Azores', lat: 37.74, lng: -25.67 },
      'Atlantic/Reykjavik': { label: 'Reykjavík', lat: 64.15, lng: -21.94 },
    },
  },
  {
    region: 'Australia & Pacific',
    zones: {
      'Australia/Adelaide': { label: 'Adelaide', lat: -34.93, lng: 138.6 },
      'Australia/Brisbane': { label: 'Brisbane', lat: -27.47, lng: 153.03 },
      'Australia/Melbourne': { label: 'Melbourne', lat: -37.81, lng: 144.96 },
      'Australia/Perth': { label: 'Perth', lat: -31.95, lng: 115.86 },
      'Australia/Sydney': { label: 'Sydney', lat: -33.87, lng: 151.21 },
      'Pacific/Auckland': { label: 'Auckland', lat: -36.85, lng: 174.76 },
      'Pacific/Fiji': { label: 'Fiji', lat: -18.14, lng: 178.44 },
      'Pacific/Honolulu': { label: 'Honolulu', lat: 21.31, lng: -157.86 },
      'Pacific/Kiritimati': { label: 'Kiritimati', lat: 1.87, lng: -157.4 },
      'Pacific/Niue': { label: 'Niue', lat: -19.05, lng: -169.92 },
    },
  },
  {
    region: 'Europe',
    zones: {
      'Europe/Amsterdam': { label: 'Amsterdam', lat: 52.37, lng: 4.9 },
      'Europe/Athens': { label: 'Athens', lat: 37.98, lng: 23.73 },
      'Europe/Berlin': { label: 'Berlin', lat: 52.52, lng: 13.4 },
      'Europe/Dublin': { label: 'Dublin', lat: 53.35, lng: -6.26 },
      'Europe/Helsinki': { label: 'Helsinki', lat: 60.17, lng: 24.94 },
      'Europe/Istanbul': { label: 'Istanbul', lat: 41.01, lng: 28.98 },
      'Europe/Lisbon': { label: 'Lisbon', lat: 38.72, lng: -9.14 },
      'Europe/London': { label: 'London', lat: 51.51, lng: -0.13 },
      'Europe/Madrid': { label: 'Madrid', lat: 40.42, lng: -3.7 },
      'Europe/Moscow': { label: 'Moscow', lat: 55.76, lng: 37.62 },
      'Europe/Paris': { label: 'Paris', lat: 48.85, lng: 2.35 },
      'Europe/Prague': { label: 'Prague', lat: 50.08, lng: 14.44 },
      'Europe/Rome': { label: 'Rome', lat: 41.9, lng: 12.5 },
      'Europe/Vienna': { label: 'Vienna', lat: 48.21, lng: 16.37 },
      'Europe/Warsaw': { label: 'Warsaw', lat: 52.23, lng: 21.01 },
      'Europe/Zurich': { label: 'Zurich', lat: 47.37, lng: 8.54 },
    },
  },
  {
    region: 'UTC',
    zones: {
      UTC: { label: 'UTC', lat: 51.48, lng: 0 },
    },
  },
];

const CURATED: Record<string, ZoneEntry> = Object.fromEntries(
  REGIONS.flatMap((r) => Object.entries(r.zones)),
);

/** Cached at module load: `supportedValuesOf` does real work and the result
 *  is static for a given runtime, so there is no reason to recompute it per
 *  call. */
let supportedZones: Set<string> | null = null;

function getSupportedZones(): Set<string> {
  if (!supportedZones) {
    supportedZones = new Set(selectableTimezones());
  }
  return supportedZones;
}

export function isValidTimezone(tz: string): boolean {
  // Delegates rather than checking membership in the picker list. The list is
  // what we *offer*; this answers whether the runtime can *resolve* it, which
  // is a superset. A member whose browser reports a zone we do not enumerate
  // should still be able to join.
  return canResolveTimezone(tz);
}

/**
 * `offsetMinutes / 60 * 15`: 15 degrees of longitude per hour of UTC offset
 * is exactly how the globe's day/night terminator itself is derived (one
 * full rotation, 360°, over 24h) — so an offset-derived fallback marker
 * lines up with the same model the globe already uses, rather than
 * introducing a second, inconsistent notion of "where" a zone is.
 */
function offsetToLongitude(offsetMinutes: number): number {
  const lng = (offsetMinutes / 60) * 15;
  // Normalize into (-180, 180] so a UTC+13/-11 style zone doesn't produce a
  // marker that reads as "off the edge of the map."
  let normalized = lng;
  while (normalized > 180) normalized -= 360;
  while (normalized <= -180) normalized += 360;
  return normalized;
}

/** Current UTC offset for `tz`, in minutes east of UTC (matches the sign
 *  convention `offsetToLongitude` expects). Callers must validate `tz`
 *  first — this throws on an unsupported zone via `Intl.DateTimeFormat`. */
function currentOffsetMinutes(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date());
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  // Matches "GMT+5:30", "GMT-8", "GMT+0".
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzName);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');
  return sign * (hours * 60 + minutes);
}

export type ZoneInfo = {
  label: string;
  lat: number;
  lng: number;
  /** Current UTC offset in minutes east of UTC. Not DST-stable — callers
   *  needing a point-in-time offset should not cache this across days. */
  offsetMinutes: number;
};

/**
 * Resolves a zone to display + globe info. Throws on a zone
 * `selectableTimezones()` doesn't recognize — validate with
 * `isValidTimezone` first if the input is user-supplied and you want a soft
 * failure instead.
 */
export function zoneInfo(tz: string): ZoneInfo {
  if (!isValidTimezone(tz)) {
    throw new Error(`Invalid IANA timezone: "${tz}"`);
  }
  const offsetMinutes = currentOffsetMinutes(tz);
  const curated = CURATED[tz];
  if (curated) {
    return { ...curated, offsetMinutes };
  }
  return { label: tz, lat: 0, lng: offsetToLongitude(offsetMinutes), offsetMinutes };
}

export type GroupedZones = { region: string; zones: { value: string; label: string }[] }[];

/** Region -> zone options, for a `<select>`. Only the curated table — the
 *  fallback path exists for data already stored, not for offering someone
 *  an obscure zone to pick from a menu. */
export function groupedZones(): GroupedZones {
  return REGIONS.map((r) => ({
    region: r.region,
    zones: Object.entries(r.zones).map(([value, entry]) => ({ value, label: entry.label })),
  }));
}
