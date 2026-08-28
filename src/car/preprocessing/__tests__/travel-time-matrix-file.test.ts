import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  parseCarTravelTimeMatrixManifest,
  parseCarTravelTimeMatrixManifestJson,
} from '@core/car';
import type { CarLocalityRoadAnchorsFile } from '@core/car/preprocessing';
import {
  createCarTravelTimeMatrixManifest,
  loadCarTravelTimeMatrix,
  serializeCarTravelTimeMatrixManifest,
  validateCarTravelTimeMatrixAgainstAnchors,
} from '@core/car/preprocessing';
import { encodeTravelMinutesLittleEndian } from '../travel-time-matrix';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const anchorsFile: CarLocalityRoadAnchorsFile = {
  schemaVersion: 1,
  localityCount: 2,
  localityInputSha256: SHA_A,
  roadGraph: {
    sourcePbfSha256: SHA_B,
    osrmVersion: '26.8.0',
    profile: 'car.lua',
    algorithm: 'ch',
  },
  anchors: [
    {
      localityId: '3011:bern',
      latitude: 46.95,
      longitude: 7.44,
      snapDistanceMeters: 10,
    },
    {
      localityId: '8001:zurich',
      latitude: 47.37,
      longitude: 8.54,
      snapDistanceMeters: 20,
    },
  ],
};

const matrixBytes = encodeTravelMinutesLittleEndian(
  new Uint16Array([0, 93, 95, 0]),
);

function validManifest() {
  return createCarTravelTimeMatrixManifest({
    anchorsFile,
    anchorsSha256: SHA_A,
    matrixBytes,
  });
}

describe('car travel-time matrix manifest', () => {
  it('creates a strict deterministic manifest from anchor ordering and matrix bytes', () => {
    const manifest = validManifest();
    expect(manifest.localityIds).toEqual(['3011:bern', '8001:zurich']);
    expect(manifest.matrixByteLength).toBe(8);
    expect(manifest.matrixSha256).toBe(
      createHash('sha256').update(matrixBytes).digest('hex'),
    );
    expect(serializeCarTravelTimeMatrixManifest(manifest)).toBe(
      serializeCarTravelTimeMatrixManifest(manifest),
    );
    expect(parseCarTravelTimeMatrixManifestJson(JSON.stringify(manifest))).toEqual(
      manifest,
    );
  });

  it('rejects wrong schema and encoding metadata', () => {
    const manifest = validManifest();
    for (const [field, value] of [
      ['schemaVersion', 2],
      ['layout', 'COLUMN_MAJOR'],
      ['valueEncoding', 'UINT16'],
      ['unit', 'SECONDS'],
      ['unreachableValue', 0],
      ['rounding', 'ROUND'],
    ] as const) {
      expect(() =>
        parseCarTravelTimeMatrixManifest({ ...manifest, [field]: value }),
      ).toThrow(field);
    }
    expect(() =>
      parseCarTravelTimeMatrixManifest({ ...manifest, extra: true }),
    ).toThrow('unexpected field(s) extra');
  });

  it('rejects duplicate locality IDs', () => {
    const manifest = validManifest();
    expect(() =>
      parseCarTravelTimeMatrixManifest({
        ...manifest,
        localityIds: ['3011:bern', '3011:bern'],
      }),
    ).toThrow('duplicate ID "3011:bern"');
  });

  it('rejects matrix byte lengths inconsistent with the locality count', () => {
    const manifest = validManifest();
    expect(() =>
      parseCarTravelTimeMatrixManifest({
        ...manifest,
        matrixByteLength: 6,
      }),
    ).toThrow('expected 8 for 2 localities');
    expect(() =>
      loadCarTravelTimeMatrix(manifest, matrixBytes.subarray(0, 6), {
        anchorsFile,
        anchorsSha256: SHA_A,
      }),
    ).toThrow('has 6 bytes; manifest expects 8');
  });

  it('rejects the wrong binary SHA-256', () => {
    const manifest = validManifest();
    const changedBytes = Uint8Array.from(matrixBytes);
    changedBytes[2] = 94;
    expect(() =>
      loadCarTravelTimeMatrix(manifest, changedBytes, {
        anchorsFile,
        anchorsSha256: SHA_A,
      }),
    ).toThrow('does not match manifest');
  });

  it('loads a valid directional matrix and rejects a nonzero self cell', () => {
    const manifest = validManifest();
    const loaded = loadCarTravelTimeMatrix(manifest, matrixBytes, {
      anchorsFile,
      anchorsSha256: SHA_A,
    });
    expect([...loaded.values]).toEqual([0, 93, 95, 0]);

    const invalidBytes = encodeTravelMinutesLittleEndian(
      new Uint16Array([1, 93, 95, 0]),
    );
    const invalidManifest = createCarTravelTimeMatrixManifest({
      anchorsFile,
      anchorsSha256: SHA_A,
      matrixBytes: invalidBytes,
    });
    expect(() =>
      loadCarTravelTimeMatrix(invalidManifest, invalidBytes, {
        anchorsFile,
        anchorsSha256: SHA_A,
      }),
    ).toThrow('self cell');
  });

  it('requires exact anchor provenance and ordering', () => {
    const manifest = validManifest();
    expect(() =>
      validateCarTravelTimeMatrixAgainstAnchors(manifest, {
        anchorsFile,
        anchorsSha256: SHA_B,
      }),
    ).toThrow('anchor SHA-256');

    const reorderedManifest = parseCarTravelTimeMatrixManifest({
      ...manifest,
      localityIds: manifest.localityIds.toReversed(),
    });
    expect(() =>
      validateCarTravelTimeMatrixAgainstAnchors(reorderedManifest, {
        anchorsFile,
        anchorsSha256: SHA_A,
      }),
    ).toThrow('locality ID at index 0');

    expect(() =>
      validateCarTravelTimeMatrixAgainstAnchors(
        parseCarTravelTimeMatrixManifest({
          ...manifest,
          localityInputSha256: SHA_B,
        }),
        { anchorsFile, anchorsSha256: SHA_A },
      ),
    ).toThrow('locality-input fingerprint');
  });
});
