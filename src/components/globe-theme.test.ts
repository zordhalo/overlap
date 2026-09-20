import { describe, expect, it } from 'vitest';
import { globeTheme, hexToRgbFloat } from './globe-theme';

describe('hexToRgbFloat', () => {
  it('converts white to [1, 1, 1]', () => {
    expect(hexToRgbFloat('#ffffff')).toEqual([1, 1, 1]);
  });

  it('converts black to [0, 0, 0]', () => {
    expect(hexToRgbFloat('#000000')).toEqual([0, 0, 0]);
  });

  it('converts --pulse to roughly [0.596, 1, 0.22]', () => {
    const [r, g, b] = hexToRgbFloat('#98ff38');
    expect(r).toBeCloseTo(0.596, 2);
    expect(g).toBeCloseTo(1, 2);
    expect(b).toBeCloseTo(0.22, 2);
  });

  it('expands a 3-digit hex the same way as its 6-digit equivalent', () => {
    expect(hexToRgbFloat('#fff')).toEqual(hexToRgbFloat('#ffffff'));
  });

  it('accepts a hex string without a leading #', () => {
    expect(hexToRgbFloat('98ff38')).toEqual(hexToRgbFloat('#98ff38'));
  });

  it('rejects a malformed hex string', () => {
    expect(() => hexToRgbFloat('#ff')).toThrow();
  });
});

describe('globeTheme', () => {
  it('suppresses the atmosphere halo but keeps a terminator-capable light', () => {
    // glowColor at --paper is what kills cobe's halo. `diffuse` is deliberately
    // NOT 0: in cobe it is the directional light falloff, i.e. the day/night
    // terminator, which is the information the globe exists to convey. It must
    // stay above 0 and below 1 — flat at 0, blown out near 1.
    expect(globeTheme.diffuse).toBeGreaterThan(0);
    expect(globeTheme.diffuse).toBeLessThan(1);
    expect(globeTheme.glowColor).toEqual(hexToRgbFloat('#101010'));
  });

  it('every colour channel is a 0..1 float, not a 0..255 int', () => {
    for (const channel of [...globeTheme.baseColor, ...globeTheme.markerColor, ...globeTheme.glowColor]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });
});
