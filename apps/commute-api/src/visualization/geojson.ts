import type { LonLat, LonLatPosition } from './hex-grid.js';

export interface GeoJsonPolygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly LonLatPosition[])[];
}

export interface GeoJsonFeature<TProperties> {
  readonly type: 'Feature';
  readonly id?: string;
  readonly properties: TProperties;
  readonly geometry: GeoJsonPolygon;
}

export interface GeoJsonFeatureCollection<TProperties> {
  readonly type: 'FeatureCollection';
  readonly features: readonly GeoJsonFeature<TProperties>[];
}

export interface GeographicBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

const requireUsableCoordinate = (
  longitude: number,
  latitude: number,
  label: string,
): void => {
  if (
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new RangeError(`${label} must contain usable WGS84 coordinates.`);
  }
};

/** Calculate bounds around an origin and the exact polygons returned to clients. */
export function calculateGeoJsonBounds<TProperties>(
  origin: LonLat,
  featureCollection: GeoJsonFeatureCollection<TProperties>,
): GeographicBounds {
  requireUsableCoordinate(origin.longitude, origin.latitude, 'Map origin');
  let west = origin.longitude;
  let south = origin.latitude;
  let east = origin.longitude;
  let north = origin.latitude;

  for (const feature of featureCollection.features) {
    for (const ring of feature.geometry.coordinates) {
      for (const [longitude, latitude] of ring) {
        requireUsableCoordinate(longitude, latitude, 'GeoJSON vertex');
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }
    }
  }

  return { west, south, east, north };
}
