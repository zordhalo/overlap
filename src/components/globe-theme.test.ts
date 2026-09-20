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
  it('pins no atmosphere glow (diffuse 0) and glowColor to --paper', () => {
    expect(globeTheme.diffuse).toBe(0);
    expect(globeTheme.glowColor).toEqual(hexToRgbFloat('#101010'));
  });

  it('every colour channel is a 0..1 float, not a 0..255 int', () => {
    for (const channel of [...globeTheme.baseColor, ...globeTheme.markerColor, ...globeTheme.glowColor]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });
});
