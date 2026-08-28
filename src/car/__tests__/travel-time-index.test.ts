import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createTravelTimeIndex,
  getReachableLocalities,
  UNAVAILABLE_TRAVEL_TIME,
  type TravelTimeMatrixDescriptor,
} from '../../travel-time-matrix';
import {
  createCarTravelTimeIndex,
  getCarTravelMinutes,
  getReachableLocalitiesByCar,
  type CarTravelTimeIndex,
} from '../index';
import type { CarTravelTimeManifest } from '../travel-time-manifest';

const MATRIX_BYTES = Uint8Array.from([
  0, 20, 45, UNAVAILABLE_TRAVEL_TIME,
  25, 0, 10, 70,
  50, 12, 0, 180,
  UNAVAILABLE_TRAVEL_TIME, 68, 28, 0,
]);

function descriptor(): TravelTimeMatrixDescriptor {
  return {
    schemaVersion: 1,
    localityCount: 4,
    localityIds: ['A', 'B', 'C', 'D'],
    maxTravelMinutes: 240,
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT8',
    unit: 'MINUTES',
    unavailableValue: 255,
    matrixByteLength: MATRIX_BYTES.byteLength,
    matrixSha256: 'a'.repeat(64),
  };
}

function manifest(): CarTravelTimeManifest {
  return {
    mode: 'CAR',
    matrix: descriptor(),
    source: {
      sourceMatrixSha256: 'b'.repeat(64),
      anchorsSha256: 'c'.repeat(64),
      localityInputSha256: 'd'.repeat(64),
      roadGraph: {
        sourcePbfSha256: 'e'.repeat(64),
        osrmVersion: '26.8.0',
        profile: 'car.lua',
        algorithm: 'ch',
      },
    },
  };
}

describe('car travel-time façade', () => {
  it('delegates directional point lookup to the canonical matrix index', () => {
    const index = createCarTravelTimeIndex(manifest(), MATRIX_BYTES);

    expect(getCarTravelMinutes(index, 'A', 'B')).toBe(20);
    expect(getCarTravelMinutes(index, 'B', 'A')).toBe(25);
    expect(getCarTravelMinutes(index, 'A', 'D')).toBeUndefined();
  });

  it('delegates row scanning, sorting, and four-hour threshold validation', () => {
    const index = createCarTravelTimeIndex(manifest(), MATRIX_BYTES);

    const sharedIndex = createTravelTimeIndex(descriptor(), MATRIX_BYTES);
    expect(getReachableLocalitiesByCar(index, 'C', 240)).toEqual(
      getReachableLocalities(sharedIndex, 'C', 240),
    );
    expect(getReachableLocalitiesByCar(index, 'C', 240)).toEqual([
      { localityId: 'C', travelMinutes: 0 },
      { localityId: 'B', travelMinutes: 12 },
      { localityId: 'A', travelMinutes: 50 },
      { localityId: 'D', travelMinutes: 180 },
    ]);
    expect(() => getReachableLocalitiesByCar(index, 'C', 241)).toThrow(
      'between 0 and 240',
    );
  });

  it('requires the car provenance wrapper while retaining shared semantics', () => {
    expect(() => createCarTravelTimeIndex(descriptor(), MATRIX_BYTES)).toThrow(
      'missing field(s) mode, matrix, source',
    );
  });

  it('does not accept a generic or future other-mode index as a car handle', () => {
    const sharedIndex = createTravelTimeIndex(descriptor(), MATRIX_BYTES);
    expectTypeOf(sharedIndex).not.toMatchObjectType<CarTravelTimeIndex>();
    expect(() =>
      getCarTravelMinutes(
        sharedIndex as unknown as CarTravelTimeIndex,
        'A',
        'B',
      ),
    ).toThrow('Invalid car travel-time index');
  });
});
