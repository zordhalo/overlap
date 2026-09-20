/**
 * Pure spherical/solar math for the globe. No React, no cobe import, no DOM —
 * this file is unit tested in isolation (`globe-math.test.ts`) and imported
 * by `globe.tsx` for both rendering and the accessible member-state summary.
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const MS_PER_DAY = 86_400_000;

/** Wrap degrees to (-180, 180]. Longitude and hour-angle arithmetic both
 *  produce values outside that range (e.g. 190° or -370°) and every caller
 *  needs the canonical form to compare or format sanely. */
function wrapDegrees180(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * Longitude (degrees, -180..180) where the sun is directly overhead at
 * `instant`.
 *
 * Mean solar approximation: ignores the equation of time (the ±16 minute
 * wobble from Earth's elliptical orbit and axial tilt) and treats the day as
 * exactly 24h of mean solar time. Error bound: subsolar longitude is off by
 * at most ~4° (16 min * 15°/60min) at the equation of time's yearly extremes
 * (mid-Feb and early November), and 0° at the four points/year it crosses
 * zero. That is well inside the resolution this globe renders at — a
 * fraction of a degree of longitude is invisible on a marker-sized sphere —
 * so it is not worth the lookup table equation-of-time needs.
 *
 * Derivation: mean solar noon (sun overhead) happens at UTC 12:00 at
 * longitude 0. Every hour the UTC clock advances past that, the point of
 * local noon has moved 15°/hour further *west* (the earth has rotated that
 * point away from the sun), which is a *negative* longitude shift.
 */
export function subsolarLongitude(instant: number): number {
  const date = new Date(instant);
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3_600_000;
  return wrapDegrees180(-15 * (utcHours - 12));
}

/**
 * Solar declination (degrees) for `instant`: how far north/south of the
 * equator the subsolar point sits, i.e. the tilt of the analemma through the
 * year.
 *
 * Standard single-cosine approximation (used by NOAA's simplified solar
 * calculator): peaks at +23.44° around the June solstice, -23.44° around the
 * December solstice, crosses 0 at the equinoxes. Error bound: within about
 * 0.2-0.5° of the rigorous VSOP87-based value year-round, which — like the
 * equation of time above — is far finer than anything visible on the globe.
 */
function solarDeclination(instant: number): number {
  const date = new Date(instant);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((instant - startOfYear) / MS_PER_DAY) + 1;
  return -23.44 * Math.cos(((360 / 365) * (dayOfYear + 10) * DEG_TO_RAD));
}

/**
 * True if the sun is above the horizon (solar elevation > 0) at `(lat, lng)`
 * at `instant`.
 *
 * Standard solar-elevation formula:
 *   sin(elevation) = sin(lat)·sin(dec) + cos(lat)·cos(dec)·cos(H)
 * where `dec` is the solar declination and `H` is the hour angle — the
 * angular distance (in longitude) between this point and the subsolar
 * point. `H = 0` is local solar noon, `H = ±180°` is local solar midnight.
 * This ignores atmospheric refraction (which in reality extends daylight a
 * few minutes past the geometric horizon) and the equation of time folded
 * into `subsolarLongitude` above — both are civil-twilight-scale effects,
 * irrelevant to "is this half of the globe lit."
 */
export function isDaylight(lat: number, lng: number, instant: number): boolean {
  const dec = solarDeclination(instant) * DEG_TO_RAD;
  const latRad = lat * DEG_TO_RAD;
  const hourAngle = wrapDegrees180(lng - subsolarLongitude(instant)) * DEG_TO_RAD;
  const sinElevation =
    Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(hourAngle);
  return sinElevation > 0;
}

/**
 * The cobe `phi` (radians) that rotates the globe so `lng` faces the viewer.
 *
 * cobe's convention is not documented in its README beyond "phi/theta are
 * rotation angles," so this is derived from cobe 2.0.1's actual source
 * (`node_modules/cobe/dist/index.esm.js`, minified — function names below
 * refer to the minifier's identifiers) rather than guessed:
 *
 *   function U([lat, lng]) {                    // deg -> unit sphere point
 *     const r = lat * PI / 180;
 *     const a = lng * PI / 180 - PI;
 *     const o = cos(r);
 *     return [-o * cos(a), sin(r), o * sin(a)];  // [x, y, z]
 *   }
 *
 * and the per-frame projection (`O`, with closure vars `f = phi`, `l =
 * theta`):
 *
 *   c = cos(phi) * x + sin(phi) * z              // screen x (pre-viewport)
 *   s = sin(phi) sin(theta) x + cos(theta) y - cos(phi) sin(theta) z  // screen y
 *   frontFacing = -sin(phi) cos(theta) x + sin(theta) y + cos(phi) cos(theta) z >= 0
 *
 * Solving with `theta = 0` (this function only controls yaw) for the point
 * on the equator (lat = 0, so x = -cos(a), y = 0, z = sin(a)) that lands at
 * screen-center *and* front-facing (c = 0, frontFacing maximal) gives
 * `phi + a = PI/2` (mod 2*PI), i.e. `phi = PI/2 - a = 3*PI/2 - lngRad`,
 * equivalently `phi = -(lngRad + PI/2)`.
 *
 * Verified empirically in `globe-math.test.ts` by re-running cobe's own `U`
 * and the screen-space projection formula above for a spread of longitudes
 * and confirming the computed `phi` centers each one.
 */
export function phiForLongitude(lng: number): number {
  const lngRad = wrapDegrees180(lng) * DEG_TO_RAD;
  return wrapRadiansPi(-(lngRad + Math.PI / 2));
}

/** Wrap radians to (-PI, PI], the mirror of `wrapDegrees180`. */
function wrapRadiansPi(rad: number): number {
  let r = rad % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}
