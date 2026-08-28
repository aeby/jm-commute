import type {
  Locality,
  LocalityId,
} from '@jm/commute';
import type { CommuteRuntime } from '@jm/commute/node';

import type { GeographicBounds } from './visualization/geojson.js';
import type { ReachabilityHexFeatureCollection } from './visualization/reachability-hexes.js';

export type CommuteMode = 'car' | 'transit';

/** Minimal runtime surface consumed by this HTTP application. */
export interface CommuteApiRuntime {
  readonly localities: {
    all(): readonly Locality[];
    get(localityId: LocalityId): Locality | undefined;
  };
  readonly car: CommuteRuntime['car'];
  readonly transit: CommuteRuntime['transit'];
}

export interface LocalitiesResponse {
  readonly localities: readonly Locality[];
}

export interface ReachabilityRequest {
  readonly originLocalityId: LocalityId;
  readonly mode: CommuteMode;
  readonly maxTravelMinutes: number;
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
  readonly geojson: ReachabilityHexFeatureCollection;
  readonly bounds: GeographicBounds;
}

export interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}
