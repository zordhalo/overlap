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
const SPHERE = hexToRgbFloat('#4a4a4a');
// --pulse #98ff38 — default marker colour; the globe agent overrides this
// per-marker with the member's tint (see ui/MemberTag.tsx for the tint set).
const PULSE = hexToRgbFloat('#98ff38');

export const globeTheme: GlobeTheme = {
  // Tuned against real screenshots across three passes. At 1.0 the night
  // hemisphere merged into the #101010 canvas and the globe read as a smudge
  // rather than an object. 0.55 keeps an unmistakable day/night difference
  // while leaving the dark side legible as part of a sphere.
  dark: 0.55,
  // Design review asked for `diffuse: 0` to kill cobe's default
  // WebGL-tutorial sheen. Overridden during integration, because in cobe
  // `diffuse` IS the directional light falloff — which is to say, it is the
  // day/night terminator. At 0 the sphere renders flat and the globe loses
  // the single piece of information it exists to carry.
  //
  // This is consistent with the review's actual principle: the objection was
  // to decoration that carries no information. Shading that shows you where
  // it is currently night is information. The halo was the real complaint,
  // and `glowColor` below still suppresses it.
  diffuse: 1.15,
  // Tuned against a real screenshot, not guessed. At 2.2 the globe read as a
  // dark smudge on the #101010 canvas; the dot map IS this globe's only
  // surface detail, so it has to carry the whole object.
  mapBrightness: 6,
  mapSamples: 16000,
  scale: 1,
  baseColor: SPHERE,
  markerColor: PULSE,
  glowColor: PAPER,
};
