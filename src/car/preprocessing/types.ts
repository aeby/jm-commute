import type { LocalityId } from '@jm/commute';

export interface Coordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface SnappedRoadPoint extends Coordinate {
  readonly distanceMeters: number;
  readonly name?: string;
}

export interface CarRouteEstimate {
  readonly durationSeconds: number;
  readonly distanceMeters: number;
}

export interface CarDurationTable {
  readonly durationsSeconds: readonly (readonly (number | undefined)[])[];
}

export interface CarLocalityInput extends Coordinate {
  readonly localityId: LocalityId;
  readonly postalCode: string;
  readonly city: string;
}
