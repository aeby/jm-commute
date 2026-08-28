import {
  hexCellPolygon,
  lonLatToMercatorMeters,
  pointToHexCell,
  shrinkHexPolygon,
  type LonLatPosition,
} from './hex-grid.js';
import type {
  GeoJsonFeature,
  GeoJsonFeatureCollection,
} from './geojson.js';

export interface ReachabilityCoordinateSample {
  readonly longitude: number;
  readonly latitude: number;
  readonly travelMinutes: number;
}

export interface ReachabilityHex {
  readonly id: string;
  readonly travelMinutes: number;
  /** Six logical vertices; intentionally unclosed until GeoJSON conversion. */
  readonly polygon: readonly LonLatPosition[];
}

export interface ReachabilityHexProperties {
  readonly travelMinutes: number;
}

export type ReachabilityHexFeature =
  GeoJsonFeature<ReachabilityHexProperties>;

export type ReachabilityHexFeatureCollection =
  GeoJsonFeatureCollection<ReachabilityHexProperties>;

interface AggregatedCell {
  readonly q: number;
  readonly r: number;
  readonly id: string;
  travelMinutes: number;
}

const isUsableCoordinate = (
  longitude: number,
  latitude: number,
): boolean =>
  Number.isFinite(longitude) &&
  longitude >= -180 &&
  longitude <= 180 &&
  Number.isFinite(latitude) &&
  latitude >= -90 &&
  latitude <= 90;

const requireSample = (sample: ReachabilityCoordinateSample): void => {
  if (!isUsableCoordinate(sample.longitude, sample.latitude)) {
    throw new RangeError(
      'Reachability coordinates must be usable WGS84 values.',
    );
  }
  if (!Number.isFinite(sample.travelMinutes) || sample.travelMinutes < 0) {
    throw new RangeError(
      'Reachability travel minutes must be nonnegative and finite.',
    );
  }
};

/** Aggregate locality positions into deterministic minimum-duration cells. */
export function buildReachabilityHexes(
  samples: readonly ReachabilityCoordinateSample[],
  cellDiameterMeters: number,
): readonly ReachabilityHex[] {
  const cellsById = new Map<string, AggregatedCell>();

  for (const sample of samples) {
    requireSample(sample);
    const point = lonLatToMercatorMeters(sample.longitude, sample.latitude);
    const cell = pointToHexCell(point.x, point.y, cellDiameterMeters);
    const existing = cellsById.get(cell.id);
    if (existing === undefined) {
      cellsById.set(cell.id, {
        q: cell.q,
        r: cell.r,
        id: cell.id,
        travelMinutes: sample.travelMinutes,
      });
    } else if (sample.travelMinutes < existing.travelMinutes) {
      existing.travelMinutes = sample.travelMinutes;
    }
  }

  return [...cellsById.values()]
    .toSorted((left, right) => left.q - right.q || left.r - right.r)
    .map((cell): ReachabilityHex => ({
      id: cell.id,
      travelMinutes: cell.travelMinutes,
      polygon: hexCellPolygon(cell, cellDiameterMeters),
    }));
}

/** Convert aggregated cells into directly renderable Polygon GeoJSON. */
export function reachabilityHexesToFeatureCollection(
  hexes: readonly ReachabilityHex[],
  renderScale: number,
): ReachabilityHexFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: hexes.map((hex): ReachabilityHexFeature => {
      if (hex.polygon.length !== 6) {
        throw new RangeError(
          `Reachability hex "${hex.id}" must have six vertices.`,
        );
      }
      const renderedPolygon = shrinkHexPolygon(hex.polygon, renderScale);
      const ring = renderedPolygon.map(
        ([longitude, latitude]): LonLatPosition => [longitude, latitude],
      );
      const first = ring[0];
      if (first === undefined) {
        throw new RangeError(`Reachability hex "${hex.id}" has no vertices.`);
      }
      ring.push([first[0], first[1]]);

      return {
        type: 'Feature',
        id: hex.id,
        properties: { travelMinutes: hex.travelMinutes },
        geometry: { type: 'Polygon', coordinates: [ring] },
      };
    }),
  };
}
