import { describe, expect, it } from 'vitest';

import type { TravelTimeMatrixDescriptor } from '../../../travel-time-matrix';
import {
  getTransitOriginReachabilityCountAtIndex,
  inspectTransitTravelTimeMatrix,
} from '../travel-time-matrix-diagnostics';

const LOCALITY_IDS = ['A', 'B', 'C', 'D'] as const;

function descriptor(matrixByteLength = 16): TravelTimeMatrixDescriptor {
  return {
    schemaVersion: 1,
    localityCount: 4,
    localityIds: LOCALITY_IDS,
    maxTravelMinutes: 240,
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT8',
    unit: 'MINUTES',
    unavailableValue: 255,
    matrixByteLength,
    matrixSha256: 'a'.repeat(64),
  };
}

const MATRIX = Uint8Array.of(
  0, 10, 255, 40,
  20, 0, 30, 255,
  255, 30, 0, 240,
  50, 255, 200, 0,
);

describe('transit travel-time matrix diagnostics', () => {
  it('reports the complete cell and national reachability distributions', () => {
    const diagnostics = inspectTransitTravelTimeMatrix(descriptor(), MATRIX);

    expect(diagnostics.totalCells).toBe(16);
    expect(diagnostics.cellDistribution).toEqual({
      zeroMinutes: 4,
      minutes1To30: 4,
      minutes31To60: 2,
      minutes61To90: 0,
      minutes91To120: 0,
      minutes121To180: 0,
      minutes181To240: 2,
      unavailable: 4,
    });
    expect(diagnostics.reachabilityByThreshold[0]?.statistics).toEqual({
      minimum: 1,
      median: 2,
      mean: 2,
      p95: 3,
      maximum: 3,
    });
    expect(diagnostics.reachabilityByThreshold[1]?.statistics).toEqual({
      minimum: 2,
      median: 2.5,
      mean: 2.5,
      p95: 3,
      maximum: 3,
    });
    expect(getTransitOriginReachabilityCountAtIndex(diagnostics, 0, 30)).toBe(2);
    expect(getTransitOriginReachabilityCountAtIndex(diagnostics, 0, 240)).toBe(3);
  });

  it('reports full directional pair statistics', () => {
    const directionality = inspectTransitTravelTimeMatrix(
      descriptor(),
      MATRIX,
    ).directionality;

    expect(directionality).toEqual({
      unorderedPairCount: 6,
      equalDirections: 1,
      differentDirections: 3,
      reachableOneDirectionOnly: 0,
      unavailableBothDirections: 2,
      mutuallyReachablePairCount: 4,
      medianAbsoluteDifferenceMinutes: 10,
      p95AbsoluteDifferenceMinutes: 40,
      maximumAbsoluteDifferenceMinutes: 40,
    });
  });

  it('deterministically ranks connectivity and lists self-only origins', () => {
    const bytes = Uint8Array.of(
      0, 255, 255, 255,
      255, 0, 10, 20,
      255, 30, 0, 40,
      255, 50, 60, 0,
    );
    const diagnostics = inspectTransitTravelTimeMatrix(descriptor(), bytes);

    expect(diagnostics.selfOnlyOriginLocalityIds).toEqual(['A']);
    expect(diagnostics.leastConnectedOrigins[0]).toEqual({
      localityId: 'A',
      reachableWithin240Minutes: 1,
    });
    expect(diagnostics.mostConnectedOrigins.map(({ localityId }) => localityId))
      .toEqual(['B', 'C', 'D', 'A']);
  });

  it('uses the shared format validation for byte length and diagonal values', () => {
    expect(() =>
      inspectTransitTravelTimeMatrix(descriptor(), MATRIX.subarray(0, 15)),
    ).toThrow('descriptor expects 16');
    const invalidDiagonal = Uint8Array.from(MATRIX);
    invalidDiagonal[5] = 1;
    expect(() =>
      inspectTransitTravelTimeMatrix(descriptor(), invalidDiagonal),
    ).toThrow('self cell');
  });
});
