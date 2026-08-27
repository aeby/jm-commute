import { describe, expect, it } from 'vitest';

import { buildPatternAdjacency } from '../build-pattern-adjacency';
import type { RaptorRoutePattern } from '../types';

const pattern = (stops: readonly number[]): RaptorRoutePattern => ({
  stops: new Uint32Array(stops),
  stopTimes: new Uint32Array(stops.length * 2),
  pickupDropOffTypes: new Uint8Array(Math.ceil(stops.length / 2)),
  tripCount: 1,
});

describe('buildPatternAdjacency', () => {
  it('retains every pattern and stop-index occurrence deterministically', () => {
    const adjacency = buildPatternAdjacency(
      [pattern([0, 1, 0]), pattern([1, 2])],
      4,
    );

    expect(adjacency.map((pairs) => Array.from(pairs))).toEqual([
      [0, 0, 0, 2],
      [0, 1, 1, 0],
      [1, 1],
      [],
    ]);
  });

  it('keeps repeated occurrences of one stop within one pattern', () => {
    const adjacency = buildPatternAdjacency([pattern([2, 2, 2])], 3);

    expect(Array.from(adjacency[2] ?? [])).toEqual([
      0, 0,
      0, 1,
      0, 2,
    ]);
  });

  it('returns an empty typed array for stops without patterns', () => {
    const adjacency = buildPatternAdjacency([pattern([0])], 3);

    expect(adjacency[1]).toBeInstanceOf(Uint32Array);
    expect(adjacency[1]).toHaveLength(0);
    expect(adjacency[2]).toHaveLength(0);
  });

  it('rejects patterns referencing a stop outside the dense mapping', () => {
    expect(() => buildPatternAdjacency([pattern([3])], 3)).toThrow(
      /unknown numeric stop/i,
    );
  });
});
