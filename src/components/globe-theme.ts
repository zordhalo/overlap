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
// --rule #212121 — the graphite sphere body.
const RULE = hexToRgbFloat('#212121');
// --pulse #98ff38 — default marker colour; the globe agent overrides this
// per-marker with the member's tint (see ui/MemberTag.tsx for the tint set).
const PULSE = hexToRgbFloat('#98ff38');

export const globeTheme: GlobeTheme = {
  dark: 1,
  diffuse: 0,
  mapBrightness: 2.2,
  mapSamples: 16000,
  scale: 1,
  baseColor: RULE,
  markerColor: PULSE,
  glowColor: PAPER,
};
