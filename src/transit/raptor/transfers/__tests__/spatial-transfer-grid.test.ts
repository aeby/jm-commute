import { describe, expect, it } from 'vitest';

import { haversineDistanceMeters } from '../../../places';
import { forEachSpatialTransferCandidate } from '../spatial-transfer-grid';
import type { ActiveTransferStop } from '../types';

const EARTH_RADIUS_METERS = 6_371_008.8;
const MAXIMUM_DISTANCE_METERS = 500;

const stopAtMeters = (
  stopIndex: number,
  x: number,
  y: number,
): ActiveTransferStop => ({
  stopIndex,
  sourceStopId: `stop-${stopIndex}`,
  latitude: (y / EARTH_RADIUS_METERS) * (180 / Math.PI),
  longitude: (x / EARTH_RADIUS_METERS) * (180 / Math.PI),
});

const candidates = (
  stops: readonly ActiveTransferStop[],
): readonly string[] => {
  const pairs: string[] = [];
  forEachSpatialTransferCandidate(
    stops,
    MAXIMUM_DISTANCE_METERS,
    (left, right) => pairs.push(`${left.stopIndex}:${right.stopIndex}`),
  );
  return pairs;
};

describe('forEachSpatialTransferCandidate', () => {
  it.each([
    ['same bucket', stopAtMeters(0, 10, 10), stopAtMeters(1, 20, 20)],
    ['horizontal neighbor', stopAtMeters(0, 490, 10), stopAtMeters(1, 510, 10)],
    ['vertical neighbor', stopAtMeters(0, 10, 490), stopAtMeters(1, 10, 510)],
    ['diagonal neighbor', stopAtMeters(0, 490, 490), stopAtMeters(1, 510, 510)],
    ['bucket boundary', stopAtMeters(0, 499.9, 0), stopAtMeters(1, 500.1, 0)],
  ])('discovers a pair in the %s case', (_label, left, right) => {
    expect(candidates([left, right])).toEqual(['0:1']);
  });

  it('does not inspect stops in distant buckets', () => {
    expect(candidates([stopAtMeters(0, 0, 0), stopAtMeters(1, 2_000, 0)])).toEqual(
      [],
    );
  });

  it('does not miss any brute-force radius pair on a small fixture', () => {
    const stops = [
      stopAtMeters(0, 0, 0),
      stopAtMeters(1, 450, 0),
      stopAtMeters(2, 0, 450),
      stopAtMeters(3, 350, 350),
      stopAtMeters(4, 1_200, 0),
    ];
    const gridPairs = new Set(candidates(stops));
    const expectedPairs = new Set<string>();

    for (let left = 0; left < stops.length; left += 1) {
      for (let right = left + 1; right < stops.length; right += 1) {
        const leftStop = stops[left];
        const rightStop = stops[right];
        if (
          leftStop?.latitude !== undefined &&
          leftStop.longitude !== undefined &&
          rightStop?.latitude !== undefined &&
          rightStop.longitude !== undefined &&
          haversineDistanceMeters(
            { latitude: leftStop.latitude, longitude: leftStop.longitude },
            { latitude: rightStop.latitude, longitude: rightStop.longitude },
          ) <= MAXIMUM_DISTANCE_METERS
        ) {
          expectedPairs.add(`${left}:${right}`);
        }
      }
    }

    expectedPairs.forEach((pair) => expect(gridPairs.has(pair)).toBe(true));
  });
});
