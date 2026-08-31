export type LocalityId = string;

export interface Locality {
  readonly localityId: LocalityId;
  readonly postalCode: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
}

export type CommuteMode = 'road' | 'public_transport';

export type LongitudeLatitudePosition = [number, number];

export interface ReachabilityHexProperties {
  readonly travelMinutes: number;
}

export interface ReachabilityFeature {
  readonly type: 'Feature';
  readonly id?: string;
  readonly properties: ReachabilityHexProperties;
  readonly geometry: {
    readonly type: 'Polygon';
    readonly coordinates: LongitudeLatitudePosition[][];
  };
}

export interface ReachabilityFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: ReachabilityFeature[];
}

export interface GeographicBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface LocalitiesResponse {
  readonly localities: readonly Locality[];
}

export interface ReachabilityResponse {
  readonly origin: {
    readonly localityId: LocalityId;
    readonly latitude: number;
    readonly longitude: number;
  };
  readonly mode: CommuteMode;
  readonly maxTravelMinutes: number;
  readonly reachableLocalityCount: number;
  readonly hexagonCount: number;
  readonly geojson: ReachabilityFeatureCollection;
  readonly bounds: GeographicBounds;
}

export interface CommuteApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}
