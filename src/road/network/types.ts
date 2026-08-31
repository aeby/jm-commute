import type { LocalityId } from '@jobmate/commute';

import type { RoadGraphMetadata } from '../prepare';

export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface SnappedRoadPoint extends Coordinate {
  readonly distanceMeters: number;
}

export interface RoadRouteEstimate {
  readonly durationSeconds: number;
}

export interface RoadDurationTable {
  readonly durationsSeconds: readonly (readonly (number | undefined)[])[];
}

export interface RoadRouter {
  findNearestRoadPoint(coordinate: Coordinate): Promise<SnappedRoadPoint>;
  getDurationTable(
    sources: readonly Coordinate[],
    destinations: readonly Coordinate[],
  ): Promise<RoadDurationTable>;
  estimateRoute(
    from: Coordinate,
    to: Coordinate,
  ): Promise<RoadRouteEstimate | undefined>;
}

export interface RoadLocalityAnchor extends Coordinate {
  readonly localityId: LocalityId;
  readonly snapDistanceMeters: number;
}

export interface RoadNetwork {
  readonly router: RoadRouter;
  readonly localities: readonly RoadLocalityAnchor[];
  readonly localityInputSha256: string;
  readonly anchorsSha256: string;
  readonly roadGraph: RoadGraphMetadata;
}
