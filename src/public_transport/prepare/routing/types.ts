import type { PickupDropOffType } from '../gtfs/types';

export interface RoutingFrequencyWindow {
  readonly startTimeSeconds: number;
  readonly endTimeSeconds: number;
  readonly headwaySeconds: number;
}

export interface RoutingStopTime {
  readonly stopId: string;
  readonly arrivalTimeSeconds: number;
  readonly departureTimeSeconds: number;
  readonly pickupType: PickupDropOffType;
  readonly dropOffType: PickupDropOffType;
}

export interface RoutingTrip {
  readonly tripId: string;
  readonly routeId: string;
  readonly stopTimes: readonly RoutingStopTime[];
  readonly frequencyWindows: readonly RoutingFrequencyWindow[];
}

export interface FixedDayRoutingManifest {
  readonly schemaVersion: 1;
  readonly sourceFeedVersion?: string;
  readonly serviceDate: string;
  readonly routingWindowStart: string;
  readonly routingWindowEnd: string;
  /** SHA-256 of the canonical UTF-8 NDJSON content. */
  readonly tripsSha256: string;
  readonly tripCount: number;
  readonly scheduledTripCount: number;
  readonly frequencyTripCount: number;
  readonly stopTimeCount: number;
  readonly frequencyWindowCount: number;
}
