import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createTravelTimeIndex,
  getReachableLocalities,
} from '../../travel-time-matrix/index.js';
import {
  createTransitTravelTimeIndex,
  getReachableLocalitiesByTransit,
  getTransitTravelMinutes,
  type TransitTravelTimeIndex,
} from '../index.js';
import {
  TRANSIT_MATRIX_BYTES,
  transitManifest,
} from './travel-time-fixture.js';

describe('transit travel-time façade', () => {
  it('delegates directional point lookup to the canonical matrix index', () => {
    const index = createTransitTravelTimeIndex(
      transitManifest(),
      TRANSIT_MATRIX_BYTES,
    );

    expect(getTransitTravelMinutes(index, 'A', 'B')).toBe(20);
    expect(getTransitTravelMinutes(index, 'B', 'A')).toBe(25);
    expect(getTransitTravelMinutes(index, 'A', 'D')).toBeUndefined();
  });

  it('delegates row scanning and the complete four-hour threshold', () => {
    const manifest = transitManifest();
    const index = createTransitTravelTimeIndex(
      manifest,
      TRANSIT_MATRIX_BYTES,
    );
    const sharedIndex = createTravelTimeIndex(
      manifest.matrix,
      TRANSIT_MATRIX_BYTES,
    );

    expect(getReachableLocalitiesByTransit(index, 'C', 240)).toEqual(
      getReachableLocalities(sharedIndex, 'C', 240),
    );
    expect(getReachableLocalitiesByTransit(index, 'C', 240)).toEqual([
      { localityId: 'C', travelMinutes: 0 },
      { localityId: 'B', travelMinutes: 12 },
      { localityId: 'A', travelMinutes: 50 },
      { localityId: 'D', travelMinutes: 180 },
    ]);
    expect(() => getReachableLocalitiesByTransit(index, 'C', 241)).toThrow(
      'between 0 and 240',
    );
  });

  it('requires the transit provenance wrapper', () => {
    expect(() =>
      createTransitTravelTimeIndex(
        transitManifest().matrix,
        TRANSIT_MATRIX_BYTES,
      ),
    ).toThrow('missing field(s) mode, matrix, source');
  });

  it('keeps the shared index out of the transit façade type', () => {
    const sharedIndex = createTravelTimeIndex(
      transitManifest().matrix,
      TRANSIT_MATRIX_BYTES,
    );
    expectTypeOf(sharedIndex).not.toMatchTypeOf<TransitTravelTimeIndex>();
  });
});
