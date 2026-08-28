import { describe, expect, it } from 'vitest';

import {
  buildReachabilityHexes,
  extractReachableStopSamples,
  reachabilityHexesToFeatureCollection,
  type ReachableStopSample,
} from '../reachability-hexes';

const CELL_DIAMETER_METERS = 1_000;

describe('extractReachableStopSamples', () => {
  it('ignores unreachable stops and converts seconds to minutes', () => {
    const samples = extractReachableStopSamples(
      Uint32Array.of(90, 0xffff_ffff, 1_800),
      Float32Array.of(7, 46, 8, 47, 9, 48),
    );

    expect(samples).toEqual([
      { longitude: 7, latitude: 46, travelMinutes: 1.5 },
      { longitude: 9, latitude: 48, travelMinutes: 30 },
    ]);
  });

  it('ignores stops whose coordinates are missing or unusable', () => {
    const samples = extractReachableStopSamples(
      Uint32Array.of(60, 120, 180, 240, 300),
      Float32Array.of(
        7, 46,
        Number.NaN, 47,
        8, Number.NaN,
        Number.POSITIVE_INFINITY, 48,
        181, 49,
      ),
    );

    expect(samples).toEqual([
      { longitude: 7, latitude: 46, travelMinutes: 1 },
    ]);
  });

  it('requires coordinates aligned with every numeric stop index', () => {
    expect(() =>
      extractReachableStopSamples(Uint32Array.of(60, 120), Float32Array.of(7, 46)),
    ).toThrow(/twice the duration-array length/i);
  });
});

describe('buildReachabilityHexes', () => {
  it('keeps the minimum stop duration in each cell', () => {
    const stops: readonly ReachableStopSample[] = [
      { longitude: 8.5417, latitude: 47.3769, travelMinutes: 34 },
      { longitude: 8.5418, latitude: 47.3769, travelMinutes: 29 },
      { longitude: 8.5417, latitude: 47.377, travelMinutes: 31 },
    ];

    const hexes = buildReachabilityHexes(stops, CELL_DIAMETER_METERS);

    expect(hexes).toHaveLength(1);
    expect(hexes[0]?.travelMinutes).toBe(29);
  });

  it('returns deterministic sorted results regardless of input order', () => {
    const stops: readonly ReachableStopSample[] = [
      { longitude: 8.5417, latitude: 47.3769, travelMinutes: 10 },
      { longitude: 7.4474, latitude: 46.948, travelMinutes: 20 },
      { longitude: 9.0667, latitude: 47.05, travelMinutes: 30 },
      { longitude: 7.4475, latitude: 46.948, travelMinutes: 15 },
    ];

    const forward = buildReachabilityHexes(stops, CELL_DIAMETER_METERS);
    const reverse = buildReachabilityHexes(
      stops.toReversed(),
      CELL_DIAMETER_METERS,
    );

    expect(reverse).toEqual(forward);
    const axialCoordinates = forward.map(({ id }) =>
      id.split(',').map(Number) as [number, number],
    );
    expect(axialCoordinates).toEqual(
      axialCoordinates.toSorted(
        ([leftQ, leftR], [rightQ, rightR]) =>
          leftQ - rightQ || leftR - rightR,
      ),
    );
  });
});

describe('reachabilityHexesToFeatureCollection', () => {
  it('creates one feature collection with duration properties', () => {
    const hexes = buildReachabilityHexes(
      [{ longitude: 8.5417, latitude: 47.3769, travelMinutes: 22.5 }],
      CELL_DIAMETER_METERS,
    );

    const collection = reachabilityHexesToFeatureCollection(hexes);

    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties).toEqual({ travelMinutes: 22.5 });
  });

  it('closes every six-vertex polygon when converting it to GeoJSON', () => {
    const hexes = buildReachabilityHexes(
      [{ longitude: 8.5417, latitude: 47.3769, travelMinutes: 15 }],
      CELL_DIAMETER_METERS,
    );

    expect(hexes[0]?.polygon).toHaveLength(6);
    const ring = reachabilityHexesToFeatureCollection(hexes)
      .features[0]?.geometry.coordinates[0];
    expect(ring).toHaveLength(7);
    expect(ring?.at(-1)).toEqual(ring?.[0]);
  });

  it('shrinks only rendered geometry without changing aggregation or cell identity', () => {
    const stops: readonly ReachableStopSample[] = [
      { longitude: 8.5417, latitude: 47.3769, travelMinutes: 34 },
      { longitude: 8.5418, latitude: 47.3769, travelMinutes: 29 },
    ];
    const hexes = buildReachabilityHexes(stops, CELL_DIAMETER_METERS);
    const logicalSnapshot = structuredClone(hexes);

    const fullSize = reachabilityHexesToFeatureCollection(hexes);
    const withGap = reachabilityHexesToFeatureCollection(hexes, 0.88);

    expect(hexes).toEqual(logicalSnapshot);
    expect(withGap.features.map(({ id, properties }) => ({ id, properties })))
      .toEqual(
        fullSize.features.map(({ id, properties }) => ({ id, properties })),
      );
    expect(withGap.features[0]?.geometry.coordinates)
      .not.toEqual(fullSize.features[0]?.geometry.coordinates);
    expect(hexes[0]?.travelMinutes).toBe(29);
  });
});
