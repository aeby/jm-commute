import { describe, expect, it } from 'vitest';

import {
  calculateTravelTimeMatrixByteLength,
  calculateTravelTimeMatrixCellCount,
  getTravelTimeMatrixCellIndex,
  parseCarTravelTimeMatrixManifest,
  parseCarTravelTimeMatrixManifestJson,
  type CarTravelTimeMatrixManifest,
} from '../travel-time-matrix-format';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function validManifest(): CarTravelTimeMatrixManifest {
  return {
    schemaVersion: 1,
    localityCount: 2,
    localityIds: ['3011:bern', '8001:zurich'],
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT16_LE',
    unit: 'MINUTES',
    unreachableValue: 65_535,
    rounding: 'CEIL_SECONDS_TO_MINUTES',
    anchorsSha256: SHA_A,
    localityInputSha256: SHA_B,
    roadGraph: {
      sourcePbfSha256: SHA_A,
      osrmVersion: '26.8.0',
      profile: 'car.lua',
      algorithm: 'ch',
    },
    matrixByteLength: 8,
    matrixSha256: SHA_B,
  };
}

describe('platform-neutral car travel-time matrix format', () => {
  it('strictly parses the deterministic manifest contract', () => {
    const manifest = validManifest();
    expect(parseCarTravelTimeMatrixManifest(manifest)).toEqual(manifest);
    expect(parseCarTravelTimeMatrixManifestJson(JSON.stringify(manifest))).toEqual(
      manifest,
    );
  });

  it.each([
    ['schemaVersion', 2],
    ['layout', 'COLUMN_MAJOR'],
    ['valueEncoding', 'UINT16_BE'],
    ['unit', 'SECONDS'],
    ['unreachableValue', 0],
  ] as const)('rejects the wrong %s', (field, value) => {
    expect(() =>
      parseCarTravelTimeMatrixManifest({
        ...validManifest(),
        [field]: value,
      }),
    ).toThrow(field);
  });

  it('rejects duplicate locality IDs, incorrect byte length, and extra data', () => {
    expect(() =>
      parseCarTravelTimeMatrixManifest({
        ...validManifest(),
        localityIds: ['3011:bern', '3011:bern'],
      }),
    ).toThrow('duplicate ID "3011:bern"');
    expect(() =>
      parseCarTravelTimeMatrixManifest({
        ...validManifest(),
        matrixByteLength: 6,
      }),
    ).toThrow('expected 8 for 2 localities');
    expect(() =>
      parseCarTravelTimeMatrixManifest({
        ...validManifest(),
        generatedAt: 'not allowed',
      }),
    ).toThrow('unexpected field(s) generatedAt');
  });

  it('owns safe row-major cell and byte calculations', () => {
    expect(calculateTravelTimeMatrixCellCount(4)).toBe(16);
    expect(calculateTravelTimeMatrixByteLength(4)).toBe(32);
    expect(getTravelTimeMatrixCellIndex(4, 1, 3)).toBe(7);
    expect(getTravelTimeMatrixCellIndex(4, 3, 1)).toBe(13);
  });
});
