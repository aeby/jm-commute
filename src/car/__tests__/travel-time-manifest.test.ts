import { describe, expect, it } from 'vitest';

import {
  parseCarTravelTimeManifest,
  parseCarTravelTimeManifestJson,
  type CarTravelTimeManifest,
} from '../travel-time-manifest';

function manifest(): CarTravelTimeManifest {
  return {
    mode: 'CAR',
    matrix: {
      schemaVersion: 1,
      localityCount: 2,
      localityIds: ['A', 'B'],
      maxTravelMinutes: 240,
      layout: 'ROW_MAJOR',
      valueEncoding: 'UINT8',
      unit: 'MINUTES',
      unavailableValue: 255,
      matrixByteLength: 4,
      matrixSha256: 'a'.repeat(64),
    },
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

describe('parseCarTravelTimeManifest', () => {
  it('accepts the strict transport-specific wrapper around the shared descriptor', () => {
    const value = manifest();

    expect(parseCarTravelTimeManifest(value)).toEqual(value);
    expect(parseCarTravelTimeManifestJson(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    ['mode', { ...manifest(), mode: 'TRANSIT' }],
    ['source field', { ...manifest(), source: { ...manifest().source, extra: true } }],
    [
      'source digest',
      {
        ...manifest(),
        source: { ...manifest().source, sourceMatrixSha256: 'not-a-hash' },
      },
    ],
    [
      'road graph profile',
      {
        ...manifest(),
        source: {
          ...manifest().source,
          roadGraph: { ...manifest().source.roadGraph, profile: 'custom.lua' },
        },
      },
    ],
  ])('rejects invalid %s provenance', (_label, value) => {
    expect(() => parseCarTravelTimeManifest(value)).toThrow('Invalid car travel-time manifest');
  });

  it('delegates runtime matrix validation to the canonical descriptor parser', () => {
    const value = manifest();

    expect(() =>
      parseCarTravelTimeManifest({
        ...value,
        matrix: { ...value.matrix, maxTravelMinutes: 120 },
      }),
    ).toThrow('expected 240');
  });
});
