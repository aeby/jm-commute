import { describe, expect, it } from 'vitest';

import {
  hexCellPolygon,
  lonLatToMercatorMeters,
  mercatorMetersToLonLat,
  pointToHexCell,
  shrinkHexPolygon,
  type LonLatPosition,
  type MercatorMeters,
} from '../hex-grid';

const CELL_DIAMETER_METERS = 1_000;
const projectPolygon = (
  positions: readonly LonLatPosition[],
): readonly MercatorMeters[] =>
  positions.map(([longitude, latitude]) =>
    lonLatToMercatorMeters(longitude, latitude),
  );
const calculateCentroid = (
  vertices: readonly MercatorMeters[],
): MercatorMeters => ({
  x: vertices.reduce((sum, vertex) => sum + vertex.x, 0) / vertices.length,
  y: vertices.reduce((sum, vertex) => sum + vertex.y, 0) / vertices.length,
});

describe('Web Mercator coordinate conversion', () => {
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

  it('preserves longitude/latitude order', () => {
    const projected = lonLatToMercatorMeters(8, 47);
    const restored = mercatorMetersToLonLat(projected.x, projected.y);

    expect(restored.longitude).toBeCloseTo(8, 12);
    expect(restored.latitude).toBeCloseTo(47, 12);
  });
});

describe('pointToHexCell', () => {
  it('maps the same point to the same cell', () => {
    const point = lonLatToMercatorMeters(8.5417, 47.3769);

    expect(pointToHexCell(point.x, point.y, CELL_DIAMETER_METERS)).toEqual(
      pointToHexCell(point.x, point.y, CELL_DIAMETER_METERS),
    );
  });

  it('maps nearby points around a cell centre into that cell', () => {
    const centre = pointToHexCell(0, 0, CELL_DIAMETER_METERS);
    const nearby = [
      pointToHexCell(100, 100, CELL_DIAMETER_METERS),
      pointToHexCell(-100, 80, CELL_DIAMETER_METERS),
      pointToHexCell(120, -90, CELL_DIAMETER_METERS),
    ];

    expect(centre).toEqual({ id: '0,0', q: 0, r: 0 });
    expect(nearby).toEqual([centre, centre, centre]);
  });

  it('maps a neighbouring cell centre to the adjacent axial cell', () => {
    const neighbourCentreX = Math.sqrt(3) * CELL_DIAMETER_METERS / 2;

    expect(
      pointToHexCell(neighbourCentreX, 0, CELL_DIAMETER_METERS),
    ).toEqual({ id: '1,0', q: 1, r: 0 });
  });

  it('produces deterministic cell IDs, including on a boundary', () => {
    const boundaryX = Math.sqrt(3) * CELL_DIAMETER_METERS / 4;
    const results = Array.from({ length: 20 }, () =>
      pointToHexCell(boundaryX, 0, CELL_DIAMETER_METERS),
    );

    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
    expect(results.every(({ q, r }) => Number.isInteger(q) && Number.isInteger(r)))
      .toBe(true);
    expect(pointToHexCell(-0, -0, CELL_DIAMETER_METERS).id).toBe('0,0');
  });
});

describe('hexCellPolygon', () => {
  it('returns exactly six unclosed vertices', () => {
    const polygon = hexCellPolygon(
      pointToHexCell(0, 0, CELL_DIAMETER_METERS),
      CELL_DIAMETER_METERS,
    );

    expect(polygon).toHaveLength(6);
    expect(polygon.at(-1)).not.toEqual(polygon[0]);
  });

  it('uses opposite-corner diameter semantics', () => {
    const polygon = hexCellPolygon(
      pointToHexCell(0, 0, CELL_DIAMETER_METERS),
      CELL_DIAMETER_METERS,
    );
    const northern = polygon[2];
    const southern = polygon[5];
    expect(northern).toBeDefined();
    expect(southern).toBeDefined();
    const northMeters = lonLatToMercatorMeters(northern![0], northern![1]);
    const southMeters = lonLatToMercatorMeters(southern![0], southern![1]);

    expect(Math.hypot(
      northMeters.x - southMeters.x,
      northMeters.y - southMeters.y,
    )).toBeCloseTo(CELL_DIAMETER_METERS, 8);
  });
});

describe('shrinkHexPolygon', () => {
  it('preserves the polygon exactly at full render scale', () => {
    const polygon = hexCellPolygon({ q: 3, r: 4 }, CELL_DIAMETER_METERS);

    expect(shrinkHexPolygon(polygon, 1)).toEqual(polygon);
  });

  it('keeps the centre fixed while moving all six vertices inward', () => {
    const point = lonLatToMercatorMeters(8.5417, 47.3769);
    const polygon = hexCellPolygon(
      pointToHexCell(point.x, point.y, CELL_DIAMETER_METERS),
      CELL_DIAMETER_METERS,
    );
    const shrunken = shrinkHexPolygon(polygon, 0.88);
    const projectedOriginal = projectPolygon(polygon);
    const projectedShrunken = projectPolygon(shrunken);
    const originalCenter = calculateCentroid(projectedOriginal);
    const shrunkenCenter = calculateCentroid(projectedShrunken);

    expect(shrunken).toHaveLength(6);
    expect(shrunkenCenter.x).toBeCloseTo(originalCenter.x, 8);
    expect(shrunkenCenter.y).toBeCloseTo(originalCenter.y, 8);
    for (let vertexIndex = 0; vertexIndex < 6; vertexIndex += 1) {
      const original = projectedOriginal[vertexIndex]!;
      const rendered = projectedShrunken[vertexIndex]!;
      const originalDistance = Math.hypot(
        original.x - originalCenter.x,
        original.y - originalCenter.y,
      );
      const renderedDistance = Math.hypot(
        rendered.x - shrunkenCenter.x,
        rendered.y - shrunkenCenter.y,
      );
      expect(renderedDistance).toBeLessThan(originalDistance);
      expect(renderedDistance / originalDistance).toBeCloseTo(0.88, 8);
    }
  });

  it.each([0, -0.1, 1.01, Number.NaN])(
    'rejects invalid render scale %s',
    (renderScale) => {
      const polygon = hexCellPolygon({ q: 0, r: 0 }, CELL_DIAMETER_METERS);

      expect(() => shrinkHexPolygon(polygon, renderScale)).toThrow(
        /render scale/i,
      );
    },
  );
});
