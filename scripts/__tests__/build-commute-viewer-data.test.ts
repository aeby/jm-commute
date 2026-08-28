import { describe, expect, it } from 'vitest';

import type { LocalityRoutingIndex } from '../../src/transit/locality-routing';
import {
  assertLocalityRoutingIndexMatchesTimetable,
  buildStopCoordinates,
} from '../build-commute-viewer-data';

const routingIndex = (
  stopIndexes: readonly number[],
  selectionMode: 'WITHIN_ACCESS_RADIUS' | 'NEAREST_FALLBACK' =
    'WITHIN_ACCESS_RADIUS',
): LocalityRoutingIndex => ({
  entries: [
    {
      localityId: '8001:zurich',
      postalCode: '8001',
      city: 'Zürich',
      selectionMode,
      stopIndexes: Uint32Array.from(stopIndexes),
    },
  ],
});

describe('buildStopCoordinates', () => {
  it('aligns longitude/latitude pairs and leaves missing stops as NaN pairs', () => {
    const result = buildStopCoordinates(
      3,
      new Map([
        ['stop-a', 2],
        ['stop-b', 0],
        ['missing-stop', 1],
      ]),
      [
        { id: 'stop-a', longitude: 8.54, latitude: 47.38 },
        { id: 'unused-stop', longitude: 6.63, latitude: 46.52 },
        { id: 'stop-b', longitude: 7.45, latitude: 46.95 },
      ],
    );

    expect(result.coordinates[0]).toBeCloseTo(7.45);
    expect(result.coordinates[1]).toBeCloseTo(46.95);
    expect(Number.isNaN(result.coordinates[2])).toBe(true);
    expect(Number.isNaN(result.coordinates[3])).toBe(true);
    expect(result.coordinates[4]).toBeCloseTo(8.54);
    expect(result.coordinates[5]).toBeCloseTo(47.38);
    expect(result.missingCoordinateStopCount).toBe(1);
  });
});

describe('assertLocalityRoutingIndexMatchesTimetable', () => {
  it('accepts an index rebuilt against the same numeric stop ordering', () => {
    expect(() =>
      assertLocalityRoutingIndexMatchesTimetable(
        routingIndex([1, 4, 9]),
        routingIndex([1, 4, 9]),
      ),
    ).not.toThrow();
  });

  it('rejects stale numeric stop indexes', () => {
    expect(() =>
      assertLocalityRoutingIndexMatchesTimetable(
        routingIndex([1, 4, 9]),
        routingIndex([1, 5, 9]),
      ),
    ).toThrow(/numeric stop ordering/i);
  });

  it('rejects stale candidate-selection metadata', () => {
    expect(() =>
      assertLocalityRoutingIndexMatchesTimetable(
        routingIndex([1, 4], 'NEAREST_FALLBACK'),
        routingIndex([1, 4]),
      ),
    ).toThrow(/current timetable/i);
  });
});
