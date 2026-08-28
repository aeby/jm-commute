import { describe, expect, it } from 'vitest';

import {
  hexCellPolygon,
  lonLatToMercatorMeters,
  mercatorMetersToLonLat,
  pointToHexCell,
  shrinkHexPolygon,
} from '../hex-grid.js';

const CELL_DIAMETER_METERS = 2_000;

describe('Web Mercator conversion', () => {
  it.each([
    [8.5417, 47.3769],
    [7.4474, 46.948],
    [9.0667, 47.05],
    [7.7491, 46.0207],
  ])('round-trips longitude %s and latitude %s', (longitude, latitude) => {
    const projected = lonLatToMercatorMeters(longitude, latitude);
    const restored = mercatorMetersToLonLat(projected.x, projected.y);

    expect(restored.longitude).toBeCloseTo(longitude, 10);
    expect(restored.latitude).toBeCloseTo(latitude, 10);
  });

  it('rejects unusable WGS84 coordinates', () => {
    expect(() => lonLatToMercatorMeters(181, 47)).toThrow(/longitude/i);
    expect(() => lonLatToMercatorMeters(8, 91)).toThrow(/latitude/i);
  });
});

describe('deterministic hex cells', () => {
  it('maps nearby points and negative zero to a stable cell', () => {
    const center = pointToHexCell(0, 0, CELL_DIAMETER_METERS);

    expect(center).toEqual({ id: '0,0', q: 0, r: 0 });
    expect(pointToHexCell(100, 100, CELL_DIAMETER_METERS)).toEqual(center);
    expect(pointToHexCell(-0, -0, CELL_DIAMETER_METERS).id).toBe('0,0');
  });

  it('uses the configured value as opposite-corner diameter', () => {
    const polygon = hexCellPolygon({ q: 0, r: 0 }, CELL_DIAMETER_METERS);
    const northern = polygon[2]!;
    const southern = polygon[5]!;
    const northMeters = lonLatToMercatorMeters(northern[0], northern[1]);
    const southMeters = lonLatToMercatorMeters(southern[0], southern[1]);

    expect(polygon).toHaveLength(6);
    expect(Math.hypot(
      northMeters.x - southMeters.x,
      northMeters.y - southMeters.y,
    )).toBeCloseTo(CELL_DIAMETER_METERS, 8);
  });

  it('shrinks rendering without changing the logical polygon', () => {
    const polygon = hexCellPolygon({ q: 3, r: 4 }, CELL_DIAMETER_METERS);
    const snapshot = structuredClone(polygon);
    const shrunken = shrinkHexPolygon(polygon, 0.88);

    expect(polygon).toEqual(snapshot);
    expect(shrunken).toHaveLength(6);
    expect(shrunken).not.toEqual(polygon);
    expect(shrinkHexPolygon(polygon, 1)).toEqual(polygon);
  });

  it.each([0, -0.1, 1.01, Number.NaN])(
    'rejects render scale %s',
    (renderScale) => {
      const polygon = hexCellPolygon({ q: 0, r: 0 }, CELL_DIAMETER_METERS);
      expect(() => shrinkHexPolygon(polygon, renderScale)).toThrow(
        /render scale/i,
      );
    },
  );
});
