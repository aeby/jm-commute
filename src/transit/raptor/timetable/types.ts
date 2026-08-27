import type { PickupDropOffType } from '../../routing-data';

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

export interface RaptorTimetable {
  readonly sourceStopIds: readonly string[];
  readonly patterns: readonly RaptorRoutePattern[];
  readonly patternOccurrencesByStop: readonly Uint32Array[];
  readonly transfersByStop: readonly Uint32Array[];
  readonly accessTransfersByStop: readonly Uint32Array[];
}

export interface OvertakingSplitDiagnostic {
  readonly sourceRouteId: string;
  readonly stopCount: number;
  readonly tripCount: number;
  readonly resultingPatternCount: number;
}

export interface RaptorTimetableBuildStatistics {
  readonly inputRetainedTrips: number;
  readonly inputStopTimeCount: number;
  readonly inputFrequencyWindowCount: number;
  readonly scheduledConcreteTrips: number;
  readonly frequencyTemplates: number;
  readonly generatedFrequencyTrips: number;
  readonly frequencyInstancesExcludedBeforeRoutingWindow: number;
  readonly finalConcreteTrips: number;
  readonly activeNumericStops: number;
  readonly baseRoutePatterns: number;
  readonly finalNonOvertakingRoutePatterns: number;
  readonly basePatternsRequiringOvertakingSplits: number;
  readonly additionalPatternsCreatedBySplitting: number;
  readonly maximumSplitCountForOneBasePattern: number;
  readonly stopTimeEntries: number;
  readonly minimumTripsPerPattern: number;
  readonly medianTripsPerPattern: number;
  readonly maximumTripsPerPattern: number;
  readonly overtakingSplitExamples: readonly OvertakingSplitDiagnostic[];
}

export type RaptorTimetableBuildStage =
  | 'AFTER_NDJSON_INGESTION_AND_GROUPING'
  | 'AFTER_ROUTE_PATTERN_CONSTRUCTION'
  | 'AFTER_FINAL_TYPED_ARRAYS'
  | 'AFTER_TEMPORARY_BUILDERS_RELEASED';

export interface BuildRaptorTimetableOptions {
  readonly onStage?: (stage: RaptorTimetableBuildStage) => void;
  readonly onStatistics?: (
    statistics: RaptorTimetableBuildStatistics,
  ) => void;
}

export interface PackedPickupDropOffEntry {
  readonly pickupType: PickupDropOffType;
  readonly dropOffType: PickupDropOffType;
}
