import { describe, expect, it } from 'vitest';

import {
  createCarTravelTimeIndex,
  createLocalityCatalog,
  createTransitTravelTimeIndex,
} from '../index.js';
import { createCommuteRuntime } from '../internal/commute-runtime.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const MATRIX_BYTES = Uint8Array.from([0, 10, 20, 0]);
const LOCALITY_IDS = ['8001:zurich', '3011:bern'] as const;

function localityCatalog(localityIds: readonly string[] = LOCALITY_IDS) {
  const localityById = new Map([
    [
      '8001:zurich',
      {
        localityId: '8001:zurich',
        postalCode: '8001',
        city: 'Zürich',
        latitude: 47.3769,
        longitude: 8.5417,
      },
    ],
    [
      '3011:bern',
      {
        localityId: '3011:bern',
        postalCode: '3011',
        city: 'Bern',
        latitude: 46.948,
        longitude: 7.4474,
      },
    ],
  ]);
  return createLocalityCatalog({
    schemaVersion: 1,
    localityCount: 2,
    orderedLocalitySha256: SHA_A,
    localities: localityIds.map((localityId) => localityById.get(localityId)),
  });
}

function matrixDescriptor(localityIds: readonly string[]) {
  return {
    schemaVersion: 1,
    localityCount: 2,
    localityIds,
    maxTravelMinutes: 240,
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT8',
    unit: 'MINUTES',
    unavailableValue: 255,
    matrixByteLength: MATRIX_BYTES.byteLength,
    matrixSha256: SHA_A,
  };
}

function carManifest(localityIds: readonly string[]) {
  return {
    mode: 'CAR',
    matrix: matrixDescriptor(localityIds),
    source: {
      sourceMatrixSha256: SHA_A,
      anchorsSha256: SHA_A,
      localityInputSha256: SHA_B,
      roadGraph: {
        sourcePbfSha256: SHA_A,
        osrmVersion: '26.8.0',
        profile: 'car.lua',
        algorithm: 'ch',
      },
    },
  };
}

function transitManifest(localityIds: readonly string[]) {
  return {
    mode: 'TRANSIT',
    matrix: matrixDescriptor(localityIds),
    source: {
      serviceDate: '2025-01-15',
      morningWindow: { start: '07:00:00', end: '09:00:00' },
      gtfsFeedVersion: 'fixture',
      routingDataFingerprint: SHA_A,
      timetableFingerprint: SHA_A,
      localityRoutingIndexSha256: SHA_B,
      routingPolicy: {
        maxTransfers: 3,
        minTransferTimeSeconds: 120,
        virtualTransfersEnabled: true,
      },
    },
  };
}

describe('createCommuteRuntime', () => {
  it('provides both high-level transport lookups over shared locality types', () => {
    const runtime = createCommuteRuntime(
      localityCatalog(),
      createCarTravelTimeIndex(carManifest(LOCALITY_IDS), MATRIX_BYTES),
      createTransitTravelTimeIndex(
        transitManifest(LOCALITY_IDS),
        MATRIX_BYTES,
      ),
      LOCALITY_IDS,
      LOCALITY_IDS,
    );

    expect(runtime.car.getTravelMinutes('8001:zurich', '3011:bern')).toBe(10);
    expect(runtime.transit.getTravelMinutes('3011:bern', '8001:zurich')).toBe(
      20,
    );
    expect(runtime.car.getReachableLocalities('8001:zurich', 10)).toEqual([
      { localityId: '8001:zurich', travelMinutes: 0 },
      { localityId: '3011:bern', travelMinutes: 10 },
    ]);
    expect(runtime.localities.resolve({ postalCode: '8001', city: 'zurich' }))
      .toEqual(runtime.localities.get('8001:zurich'));
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it('rejects different car and transit locality ordering', () => {
    const transitLocalityIds = LOCALITY_IDS.toReversed();

    expect(() =>
      createCommuteRuntime(
        localityCatalog(),
        createCarTravelTimeIndex(carManifest(LOCALITY_IDS), MATRIX_BYTES),
        createTransitTravelTimeIndex(
          transitManifest(transitLocalityIds),
          MATRIX_BYTES,
        ),
        LOCALITY_IDS,
        transitLocalityIds,
      ),
    ).toThrow('locality ordering differs at index 0');
  });

  it('rejects a catalog ordered differently from both matrices', () => {
    const reversedLocalityIds = LOCALITY_IDS.toReversed();

    expect(() =>
      createCommuteRuntime(
        localityCatalog(reversedLocalityIds),
        createCarTravelTimeIndex(carManifest(LOCALITY_IDS), MATRIX_BYTES),
        createTransitTravelTimeIndex(
          transitManifest(LOCALITY_IDS),
          MATRIX_BYTES,
        ),
        LOCALITY_IDS,
        LOCALITY_IDS,
      ),
    ).toThrow('catalog and car runtime locality ordering differs at index 0');
  });
});
