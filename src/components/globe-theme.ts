/**
 * Pinned cobe theme (PLAN.md section 6). cobe's defaults — atmosphere glow,
 * halo'd markers, a soft base colour — read as generic WebGL-tutorial and
 * fight a system built on no decorative glow anywhere else on the page. So
 * every visually meaningful option is set explicitly here rather than left
 * to cobe's defaults, and the globe agent imports these constants instead
 * of hand-tuning its own.
 *
 * `glowColor` is set to `--paper` (not black) so a glow that does render at
 * the sphere's silhouette blends into the canvas rather than leaving a ring
 * — with `diffuse: 0` this should be near-invisible regardless, but pinning
 * it to the paper colour is the belt to diffuse's suspenders.
 */

export type GlobeTheme = {
  dark: number;
  diffuse: number;
  mapBrightness: number;
  /** Floor applied to the map texture, i.e. how lit the ocean is. */
  mapBaseBrightness: number;
  mapSamples: number;
  scale: number;
  baseColor: [number, number, number];
  markerColor: [number, number, number];
  glowColor: [number, number, number];
};

/**
 * cobe takes 0..1 floats for every colour channel, not the 0..255 range a
 * hex string implies. This is the one conversion every caller — this file,
 * the globe agent assigning a member's tint to a marker — must go through
 * rather than hand-rolling `/255` inline.
 */
export function hexToRgbFloat(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;

  if (full.length !== 6) {
    throw new Error(`hexToRgbFloat: expected a 3 or 6-digit hex colour, got "${hex}"`);
  }

  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);

  return [r / 255, g / 255, b / 255];
}

// --paper #101010 — used as the glow colour so any residual glow reads as
// canvas, not a halo.
const PAPER = hexToRgbFloat('#101010');
// The sphere body. --rule (#212121) was the first choice for a graphite
// sphere, but rendered against the #101010 canvas the globe read as a dark
// smudge rather than an object — the whole night hemisphere disappeared. Two
// steps lighter keeps it unmistakably in the graphite family while giving the
// sphere an edge you can actually see.
const SPHERE = hexToRgbFloat('#e8eaf0');
// --pulse #98ff38 — default marker colour; the globe agent overrides this
// per-marker with the member's tint (see ui/MemberTag.tsx for the tint set).
const PULSE = hexToRgbFloat('#98ff38');

export const globeTheme: GlobeTheme = {
  // `dark` is a POLARITY control, not a brightness one.
  //
  // cobe's sphere fragment is, in essence:
  //   colour = baseColor * (mix((1 - q) * pow(i, .4), q, dark) + .1)
  // where `q` is the map-dot intensity and `i` is depth toward the limb. At
  // dark = 0 the land takes the (1 - q) branch and renders DARKER than the
  // ocean; only at dark = 1 does land take `q` and render brighter. Every
  // earlier attempt here fought that by pushing mapBrightness, which is why
  // the continents kept coming out black on a pale sphere.
  dark: 1,
  // Ocean floor, and the single most important value here: it is what makes
  // the sea a mid grey rather than near-black. Without it, dark: 1 leaves the
  // ocean at baseColor * 0.1 and the globe is white continents floating on
  // nothing — which only looks acceptable on the Atlantic face, and goes black
  // the moment the Pacific rotates into view.
  mapBaseBrightness: 0.3,
  // With dark: 1 and the floor above, this puts land at about baseColor * 1.1
  // (clipped to white) and ocean at about baseColor * 0.4. Tuned between two
  // failures seen on real screenshots: at 0.2 the Pacific face went almost
  // black, and at 0.45 the ocean dots reached land brightness and the
  // coastlines disappeared into a uniform speckle.
  mapBrightness: 1,
  // Falloff toward the limb. Low enough that the continents stay white most
  // of the way out rather than greying off halfway.
  diffuse: 0.6,
  // Density, and therefore how SOLID the sphere looks — not just detail.
  //
  // cobe only colours dot centres; between them the shader falls to
  // baseColor * 0.1, which is near-black. So at a low sample count the globe
  // reads as sparse specks on a dark ball no matter how the colours are set,
  // and no amount of brightness tuning fixes it. Packing the lattice tighter
  // is what makes the ocean read as a continuous grey surface with white
  // landmasses on it.
  //
  // HARD CEILING near 32767. cobe's shader finds a point's lattice index by
  // subtracting a fixed descending series that starts at 16384, so the largest
  // index it can decompose is 16384+8192+...+1. Above that the decomposition
  // silently fails and whole bands of the sphere render black — at 64000 the
  // entire southern hemisphere disappeared. Do not raise this.
  mapSamples: 32000,
  scale: 1,
  baseColor: SPHERE,
  markerColor: PULSE,
  glowColor: PAPER,
};
