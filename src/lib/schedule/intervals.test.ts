import { describe, expect, it } from 'vitest';
import { intersect, normalize, subtract, totalDuration, union } from './intervals';

describe('normalize', () => {
  it('returns empty for empty input', () => {
    expect(normalize([])).toEqual([]);
  });

  it('drops zero-length and inverted intervals', () => {
    expect(normalize([{ start: 5, end: 5 }, { start: 10, end: 3 }])).toEqual([]);
  });

  it('merges touching intervals: [0,5) + [5,10) -> [0,10)', () => {
    expect(normalize([{ start: 0, end: 5 }, { start: 5, end: 10 }])).toEqual([{ start: 0, end: 10 }]);
  });

  it('merges overlapping intervals', () => {
    expect(normalize([{ start: 0, end: 6 }, { start: 4, end: 10 }])).toEqual([{ start: 0, end: 10 }]);
  });

  it('sorts unordered input before merging', () => {
    expect(normalize([{ start: 20, end: 30 }, { start: 0, end: 10 }])).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
  });

  it('leaves a genuine gap between non-touching intervals', () => {
    expect(normalize([{ start: 0, end: 5 }, { start: 6, end: 10 }])).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 10 },
    ]);
  });
});

describe('union', () => {
  it('is empty when both inputs are empty', () => {
    expect(union([], [])).toEqual([]);
  });

  it('merges across both inputs', () => {
    expect(union([{ start: 0, end: 5 }], [{ start: 5, end: 10 }])).toEqual([{ start: 0, end: 10 }]);
  });
});

describe('intersect', () => {
  it('is empty when either input is empty', () => {
    expect(intersect([], [{ start: 0, end: 10 }])).toEqual([]);
    expect(intersect([{ start: 0, end: 10 }], [])).toEqual([]);
  });

  it('clips to the actual overlap, not the whole matched interval', () => {
    expect(intersect([{ start: 0, end: 10 }], [{ start: 4, end: 20 }])).toEqual([{ start: 4, end: 10 }]);
  });

  it('finds multiple disjoint overlaps', () => {
    const a = [{ start: 0, end: 5 }, { start: 10, end: 15 }];
    const b = [{ start: 2, end: 3 }, { start: 12, end: 20 }];
    expect(intersect(a, b)).toEqual([{ start: 2, end: 3 }, { start: 12, end: 15 }]);
  });

  it('is empty for adjacent, non-overlapping half-open intervals', () => {
    expect(intersect([{ start: 0, end: 5 }], [{ start: 5, end: 10 }])).toEqual([]);
  });
});

describe('subtract', () => {
  it('is the identity when b is empty', () => {
    expect(subtract([{ start: 0, end: 10 }], [])).toEqual([{ start: 0, end: 10 }]);
  });

  it('empties a when a is empty', () => {
    expect(subtract([], [{ start: 0, end: 10 }])).toEqual([]);
  });

  it('produces two intervals from a middle cut', () => {
    expect(subtract([{ start: 0, end: 10 }], [{ start: 4, end: 6 }])).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ]);
  });

  it('removes a fully-covering cut entirely', () => {
    expect(subtract([{ start: 0, end: 10 }], [{ start: 0, end: 10 }])).toEqual([]);
  });

  it('handles multiple cuts across multiple source intervals', () => {
    const a = [{ start: 0, end: 10 }, { start: 20, end: 30 }];
    const b = [{ start: 2, end: 4 }, { start: 8, end: 22 }];
    expect(subtract(a, b)).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 8 },
      { start: 22, end: 30 },
    ]);
  });
});

describe('totalDuration', () => {
  it('is zero for empty input', () => {
    expect(totalDuration([])).toBe(0);
  });

  it('sums non-overlapping durations', () => {
    expect(totalDuration([{ start: 0, end: 5 }, { start: 10, end: 30 }])).toBe(25);
  });

  it('does not double-count overlapping input', () => {
    expect(totalDuration([{ start: 0, end: 10 }, { start: 5, end: 15 }])).toBe(15);
  });
});
