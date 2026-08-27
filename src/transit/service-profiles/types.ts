export interface TransitPlaceServiceProfile {
  readonly placeId: string;
  readonly departureCount: number;
  readonly routeCount: number;
  readonly railDepartureCount: number;
  readonly railRouteCount: number;
}

export interface TransitPlaceServiceProfileDataset {
  readonly serviceDate: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly profiles: readonly TransitPlaceServiceProfile[];
}
