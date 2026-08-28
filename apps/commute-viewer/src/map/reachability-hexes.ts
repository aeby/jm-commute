import {
  hexCellPolygon,
  lonLatToMercatorMeters,
  pointToHexCell,
  shrinkHexPolygon,
  type LonLatPosition,
} from './hex-grid';

const UNREACHED_DURATION_SECONDS = 0xffff_ffff;

export interface ReachableStopSample {
  readonly longitude: number;
  readonly latitude: number;
  readonly travelMinutes: number;
}

export interface ReachabilityHex {
  readonly id: string;
  readonly travelMinutes: number;
  /** Six vertices; intentionally unclosed until GeoJSON conversion. */
  readonly polygon: readonly LonLatPosition[];
}

export interface ReachabilityHexProperties {
  readonly travelMinutes: number;
}

export interface ReachabilityHexFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly properties: ReachabilityHexProperties;
  readonly geometry: {
    readonly type: 'Polygon';
    readonly coordinates: LonLatPosition[][];
  };
}

export interface ReachabilityHexFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: ReachabilityHexFeature[];
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

/**
 * Align RAPTOR durations with the dense `[lon0, lat0, lon1, lat1, ...]`
 * coordinate array and retain only reachable stops with usable coordinates.
 */
export function extractReachableStopSamples(
  durationSeconds: ArrayLike<number>,
  stopCoordinates: ArrayLike<number>,
): readonly ReachableStopSample[] {
  if (stopCoordinates.length !== durationSeconds.length * 2) {
    throw new RangeError(
      'Stop-coordinate length must be exactly twice the duration-array length.',
    );
  }

  const samples: ReachableStopSample[] = [];
  for (let stopIndex = 0; stopIndex < durationSeconds.length; stopIndex += 1) {
    const duration = durationSeconds[stopIndex];
    const longitude = stopCoordinates[stopIndex * 2];
    const latitude = stopCoordinates[stopIndex * 2 + 1];
    if (
      duration === undefined ||
      duration === UNREACHED_DURATION_SECONDS ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      longitude === undefined ||
      latitude === undefined ||
      !isUsableCoordinate(longitude, latitude)
    ) {
      continue;
    }

    samples.push({
      longitude,
      latitude,
      travelMinutes: duration / 60,
    });
  }
  return samples;
}

interface AggregatedCell {
  readonly q: number;
  readonly r: number;
  readonly id: string;
  travelMinutes: number;
}

const requireSample = (sample: ReachableStopSample): void => {
  if (!isUsableCoordinate(sample.longitude, sample.latitude)) {
    throw new RangeError('Reachable-stop coordinates must be usable WGS84 values.');
  }
  if (!Number.isFinite(sample.travelMinutes) || sample.travelMinutes < 0) {
    throw new RangeError('Reachable-stop travel minutes must be nonnegative and finite.');
  }
};

/** Aggregate reachable stop positions into deterministic minimum-duration cells. */
export function buildReachabilityHexes(
  reachableStops: readonly ReachableStopSample[],
  cellDiameterMeters: number,
): readonly ReachabilityHex[] {
  const cellsById = new Map<string, AggregatedCell>();

  for (const sample of reachableStops) {
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

/** Convert all aggregated cells into one MapLibre-compatible GeoJSON source. */
export function reachabilityHexesToFeatureCollection(
  hexes: readonly ReachabilityHex[],
  renderScale = 1,
): ReachabilityHexFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: hexes.map((hex): ReachabilityHexFeature => {
      if (hex.polygon.length !== 6) {
        throw new RangeError(`Reachability hex "${hex.id}" must have six vertices.`);
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
