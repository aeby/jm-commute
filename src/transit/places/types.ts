export interface TransitPlace {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly stopIds: readonly string[];
}

export interface NearbyTransitPlace {
  readonly place: TransitPlace;
  readonly distanceMeters: number;
}

export interface NearbyTransitPlacesOptions {
  readonly maxResults: number;
  readonly maxDistanceMeters?: number;
}
