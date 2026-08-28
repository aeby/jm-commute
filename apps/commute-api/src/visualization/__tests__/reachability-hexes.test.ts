import { describe, expect, it } from 'vitest';

import { calculateGeoJsonBounds } from '../geojson.js';
import {
  buildReachabilityHexes,
  reachabilityHexesToFeatureCollection,
  type ReachabilityCoordinateSample,
} from '../reachability-hexes.js';

const CELL_DIAMETER_METERS = 2_000;
const RENDER_SCALE = 0.88;

describe('buildReachabilityHexes', () => {
  it('keeps the minimum locality duration in a shared cell', () => {
    const samples: readonly ReachabilityCoordinateSample[] = [
      { longitude: 8.5417, latitude: 47.3769, travelMinutes: 38 },
      { longitude: 8.5418, latitude: 47.3769, travelMinutes: 31 },
      { longitude: 8.5417, latitude: 47.377, travelMinutes: 45 },
    ];

    const hexes = buildReachabilityHexes(samples, CELL_DIAMETER_METERS);

    expect(hexes).toHaveLength(1);
    expect(hexes[0]?.travelMinutes).toBe(31);
  });

  it('is deterministic regardless of input order', () => {
    const samples: readonly ReachabilityCoordinateSample[] = [
      { longitude: 8.5417, latitude: 47.3769, travelMinutes: 10 },
      { longitude: 7.4474, latitude: 46.948, travelMinutes: 20 },
      { longitude: 9.0667, latitude: 47.05, travelMinutes: 30 },
      { longitude: 7.4475, latitude: 46.948, travelMinutes: 15 },
    ];

    expect(buildReachabilityHexes(samples.toReversed(), CELL_DIAMETER_METERS))
      .toEqual(buildReachabilityHexes(samples, CELL_DIAMETER_METERS));
  });

  it('rejects invalid coordinates and durations', () => {
    expect(() => buildReachabilityHexes([
      { longitude: 181, latitude: 47, travelMinutes: 10 },
    ], CELL_DIAMETER_METERS)).toThrow(/coordinates/i);
    expect(() => buildReachabilityHexes([
      { longitude: 8, latitude: 47, travelMinutes: -1 },
    ], CELL_DIAMETER_METERS)).toThrow(/travel minutes/i);
  });
});

describe('reachability GeoJSON', () => {
  it('returns closed polygons with only travel-minute properties', () => {
    const hexes = buildReachabilityHexes([
      { longitude: 8.5417, latitude: 47.3769, travelMinutes: 22 },
    ], CELL_DIAMETER_METERS);

    const collection = reachabilityHexesToFeatureCollection(
      hexes,
      RENDER_SCALE,
    );
    const feature = collection.features[0]!;
    const ring = feature.geometry.coordinates[0]!;

    expect(collection.type).toBe('FeatureCollection');
    expect(feature.geometry.type).toBe('Polygon');
    expect(feature.properties).toEqual({ travelMinutes: 22 });
    expect(ring).toHaveLength(7);
    expect(ring.at(-1)).toEqual(ring[0]);
  });

  it('calculates bounds from origin and returned rendered polygons', () => {
    const origin = { longitude: 8.5417, latitude: 47.3769 };
    const collection = reachabilityHexesToFeatureCollection(
      buildReachabilityHexes([
        { ...origin, travelMinutes: 0 },
        { longitude: 7.4474, latitude: 46.948, travelMinutes: 60 },
      ], CELL_DIAMETER_METERS),
      RENDER_SCALE,
    );

    const bounds = calculateGeoJsonBounds(origin, collection);

    expect(bounds.west).toBeLessThan(7.4474);
    expect(bounds.east).toBeGreaterThan(8.5417);
    expect(bounds.south).toBeLessThan(46.948);
    expect(bounds.north).toBeGreaterThan(47.3769);
  });

  it('falls back to exact origin bounds for an empty overlay', () => {
    const origin = { longitude: 8.5417, latitude: 47.3769 };

    expect(calculateGeoJsonBounds(origin, {
      type: 'FeatureCollection',
      features: [],
    })).toEqual({
      west: origin.longitude,
      south: origin.latitude,
      east: origin.longitude,
      north: origin.latitude,
    });
  });
});
