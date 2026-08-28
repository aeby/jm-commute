import type { LonLat } from './hex-grid';
import type { ReachabilityHex } from './reachability-hexes';

export interface GeographicBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

const requireOrigin = (origin: LonLat): void => {
  if (
    !Number.isFinite(origin.longitude) ||
    origin.longitude < -180 ||
    origin.longitude > 180 ||
    !Number.isFinite(origin.latitude) ||
    origin.latitude < -90 ||
    origin.latitude > 90
  ) {
    throw new RangeError('Map origin must contain usable WGS84 coordinates.');
  }
};

/** Calculate bounds around an origin and an already-filtered set of hexes. */
export function calculateMapBounds(
  origin: LonLat,
  visibleHexes: readonly ReachabilityHex[],
): GeographicBounds {
  requireOrigin(origin);
  let west = origin.longitude;
  let south = origin.latitude;
  let east = origin.longitude;
  let north = origin.latitude;

  for (const hex of visibleHexes) {
    for (const [longitude, latitude] of hex.polygon) {
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        throw new RangeError(`Reachability hex "${hex.id}" has an invalid vertex.`);
      }
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
    }
  }

  return { west, south, east, north };
}

/** Filter by the selected commute limit, then calculate the visible extent. */
export function calculateVisibleMapBounds(
  origin: LonLat,
  hexes: readonly ReachabilityHex[],
  maximumTravelMinutes: number,
): GeographicBounds {
  if (!Number.isFinite(maximumTravelMinutes) || maximumTravelMinutes < 0) {
    throw new RangeError(
      'Maximum travel minutes must be nonnegative and finite.',
    );
  }
  return calculateMapBounds(
    origin,
    hexes.filter(({ travelMinutes }) => travelMinutes <= maximumTravelMinutes),
  );
}
