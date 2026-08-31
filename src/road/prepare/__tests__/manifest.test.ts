import { describe, expect, it } from 'vitest';

import {
  parseRoadPreparedDataManifest,
  parseRoadPreparedDataManifestJson,
  serializeRoadPreparedDataManifest,
} from '../manifest';

const manifest = {
  schemaVersion: 1,
  roadGraph: {
    sourcePbfSha256: 'a'.repeat(64),
    osrmVersion: '26.8.0',
    profile: 'car.lua',
    algorithm: 'ch',
  },
} as const;

describe('prepared road-data manifest', () => {
  it('round-trips the deterministic graph provenance', () => {
    const serialized = serializeRoadPreparedDataManifest(manifest);

    expect(parseRoadPreparedDataManifestJson(serialized)).toEqual(manifest);
    expect(serialized.endsWith('\n')).toBe(true);
  });

  it('rejects unexpected fields and invalid graph metadata', () => {
    expect(() =>
      parseRoadPreparedDataManifest({ ...manifest, generatedAt: 'today' }),
    ).toThrow('expected exactly');
    expect(() =>
      parseRoadPreparedDataManifest({
        ...manifest,
        roadGraph: { ...manifest.roadGraph, profile: 'custom.lua' },
      }),
    ).toThrow('expected "car.lua"');
  });
});
