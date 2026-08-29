import type { PickupDropOffType } from '../../prepare/gtfs/types';

export type StopIndex = number;

export interface RaptorRoutePattern {
  readonly stops: Uint32Array;

  /**
   * Trip-major, then stop-major arrival/departure pairs.
   *
   * [
   *   trip0-stop0-arrival,
   *   trip0-stop0-departure,
   *   trip0-stop1-arrival,
   *   trip0-stop1-departure,
   *   ...
   * ]
   */
  readonly stopTimes: Uint32Array;

  /**
   * Two stop entries per byte. For each entry, drop-off uses the lower two
   * bits of its nibble and pickup uses the upper two bits.
   */
  readonly pickupDropOffTypes: Uint8Array;

  readonly tripCount: number;
}

/** Route-pattern data built before transfer adjacency is attached. */
export interface RaptorTimetable {
  readonly sourceStopIds: readonly string[];
  readonly patterns: readonly RaptorRoutePattern[];
  readonly patternOccurrencesByStop: readonly Uint32Array[];
}

/** Complete in-memory network consumed while compiling the travel-time matrix. */
export interface PublicTransportNetwork extends RaptorTimetable {
  readonly routingWindowStartSeconds: number;
  readonly routingWindowEndSeconds: number;
  readonly transfersByStop: readonly Uint32Array[];
  readonly accessTransfersByStop: readonly Uint32Array[];
}

export interface PackedPickupDropOffEntry {
  readonly pickupType: PickupDropOffType;
  readonly dropOffType: PickupDropOffType;
}
