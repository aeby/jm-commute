import { PROJECT_CONFIG } from '../../../config';
import type { RoutingTrip } from '../../routing-data';
import { parseGtfsTimeToSeconds } from '../../service-profiles';
import { buildPatternAdjacency } from './build-pattern-adjacency';
import { buildDenseStopIds } from './dense-stop-ids';
import {
  expandRoutingTrip,
  type ExpandedConcreteTrip,
} from './expand-frequency-trips';
import {
  BaseRoutePatternGrouper,
  type GroupedConcreteTrip,
} from './group-route-patterns';
import {
  getPackedDropOffType,
  getPackedPickupType,
  packedPickupDropOffByteLength,
  setPackedPickupDropOffEntry,
} from './pickup-dropoff-codec';
import { splitOvertakingTrips } from './split-overtaking-patterns';
import type {
  BuildRaptorTimetableOptions,
  OvertakingSplitDiagnostic,
  RaptorRoutePattern,
  RaptorTimetable,
  RaptorTimetableBuildStatistics,
} from './types';

interface PartitionedRoutePatternGroup {
  readonly numericStops: Uint32Array;
  readonly chains: GroupedConcreteTrip[][];
}

const DEFAULT_REFERENCE_DEPARTURE_SECONDS = parseGtfsTimeToSeconds(
  PROJECT_CONFIG.transit.referenceScenario.departureTime,
);

const buildNumericStops = (
  sourceStopIds: readonly string[],
  stopIndexBySourceId: ReadonlyMap<string, number>,
): Uint32Array => {
  const numericStops = new Uint32Array(sourceStopIds.length);
  sourceStopIds.forEach((sourceStopId, stopIndex) => {
    const numericStopId = stopIndexBySourceId.get(sourceStopId);
    if (numericStopId === undefined) {
      throw new Error(`Missing dense stop ID for ${sourceStopId}`);
    }
    numericStops[stopIndex] = numericStopId;
  });
  return numericStops;
};

const buildTypedPattern = (
  stops: Uint32Array,
  trips: readonly GroupedConcreteTrip[],
): RaptorRoutePattern => {
  const stopCount = stops.length;
  const entryCount = trips.length * stopCount;
  const stopTimes = new Uint32Array(entryCount * 2);
  const pickupDropOffTypes = new Uint8Array(
    packedPickupDropOffByteLength(entryCount),
  );

  trips.forEach((trip, tripIndex) => {
    stopTimes.set(trip.stopTimes, tripIndex * stopCount * 2);
    for (let stopIndex = 0; stopIndex < stopCount; stopIndex += 1) {
      const targetEntryIndex = tripIndex * stopCount + stopIndex;
      setPackedPickupDropOffEntry(
        pickupDropOffTypes,
        targetEntryIndex,
        getPackedPickupType(trip.pickupDropOffTypes, stopIndex),
        getPackedDropOffType(trip.pickupDropOffTypes, stopIndex),
      );
    }
  });

  return {
    stops,
    stopTimes,
    pickupDropOffTypes,
    tripCount: trips.length,
  };
};

const calculateMedian = (sortedValues: readonly number[]): number => {
  if (sortedValues.length === 0) {
    return 0;
  }
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middle] ?? 0;
  }
  return ((sortedValues[middle - 1] ?? 0) + (sortedValues[middle] ?? 0)) / 2;
};

export const buildRaptorTimetable = async (
  routingTrips: Iterable<RoutingTrip> | AsyncIterable<RoutingTrip>,
  options: BuildRaptorTimetableOptions = {},
): Promise<RaptorTimetable> => {
  const referenceDepartureSeconds =
    options.referenceDepartureSeconds ?? DEFAULT_REFERENCE_DEPARTURE_SECONDS;
  if (
    !Number.isInteger(referenceDepartureSeconds) ||
    referenceDepartureSeconds < 0
  ) {
    throw new RangeError(
      'referenceDepartureSeconds must be a nonnegative integer',
    );
  }

  const grouper = new BaseRoutePatternGrouper();
  const sourceStopIdSet = new Set<string>();
  const inputTripIds = new Set<string>();
  let inputRetainedTrips = 0;
  let inputStopTimeCount = 0;
  let inputFrequencyWindowCount = 0;
  let scheduledConcreteTrips = 0;
  let frequencyTemplates = 0;
  let generatedFrequencyTrips = 0;
  let frequencyInstancesExcludedBeforeDeparture = 0;

  const addConcreteTrip = (trip: ExpandedConcreteTrip): void => {
    trip.sourceStopIds.forEach((stopId) => sourceStopIdSet.add(stopId));
    grouper.add(trip);
  };

  for await (const routingTrip of routingTrips) {
    if (inputTripIds.has(routingTrip.tripId)) {
      throw new Error(`Duplicate routing trip ID ${routingTrip.tripId}`);
    }
    inputTripIds.add(routingTrip.tripId);
    inputRetainedTrips += 1;
    inputStopTimeCount += routingTrip.stopTimes.length;
    inputFrequencyWindowCount += routingTrip.frequencyWindows.length;

    const expansionCounts = expandRoutingTrip(
      routingTrip,
      referenceDepartureSeconds,
      addConcreteTrip,
    );
    scheduledConcreteTrips += expansionCounts.scheduledConcreteTrips;
    frequencyTemplates += expansionCounts.frequencyTemplates;
    generatedFrequencyTrips += expansionCounts.generatedFrequencyTrips;
    frequencyInstancesExcludedBeforeDeparture +=
      expansionCounts.frequencyInstancesExcludedBeforeDeparture;
  }

  const baseGroups = grouper.finish();
  const denseStopIds = buildDenseStopIds(sourceStopIdSet);
  options.onStage?.('AFTER_NDJSON_INGESTION_AND_GROUPING');

  const partitionedGroups: PartitionedRoutePatternGroup[] = [];
  const overtakingSplitExamples: OvertakingSplitDiagnostic[] = [];
  const tripCountsPerPattern: number[] = [];
  let basePatternsRequiringOvertakingSplits = 0;
  let additionalPatternsCreatedBySplitting = 0;
  let maximumSplitCountForOneBasePattern = 0;
  let stopTimeEntries = 0;

  for (const group of baseGroups) {
    const chains = splitOvertakingTrips(
      group.trips,
      group.sourceStopIds.length,
    ).map((chain) => [...chain]);
    const resultingPatternCount = chains.length;
    maximumSplitCountForOneBasePattern = Math.max(
      maximumSplitCountForOneBasePattern,
      resultingPatternCount,
    );
    if (resultingPatternCount > 1) {
      basePatternsRequiringOvertakingSplits += 1;
      additionalPatternsCreatedBySplitting += resultingPatternCount - 1;
      if (overtakingSplitExamples.length < 10) {
        overtakingSplitExamples.push({
          sourceRouteId: group.routeId,
          stopCount: group.sourceStopIds.length,
          tripCount: group.trips.length,
          resultingPatternCount,
        });
      }
    }

    chains.forEach((chain) => {
      tripCountsPerPattern.push(chain.length);
      stopTimeEntries += chain.length * group.sourceStopIds.length;
    });
    partitionedGroups.push({
      numericStops: buildNumericStops(
        group.sourceStopIds,
        denseStopIds.stopIndexBySourceId,
      ),
      chains,
    });
    group.trips.length = 0;
  }

  baseGroups.length = 0;
  grouper.clear();
  sourceStopIdSet.clear();
  inputTripIds.clear();
  options.onStage?.('AFTER_ROUTE_PATTERN_CONSTRUCTION');

  const patterns: RaptorRoutePattern[] = [];
  partitionedGroups.forEach(({ numericStops, chains }) => {
    chains.forEach((chain) => {
      patterns.push(buildTypedPattern(numericStops, chain));
    });
  });
  const patternOccurrencesByStop = buildPatternAdjacency(
    patterns,
    denseStopIds.sourceStopIds.length,
  );
  options.onStage?.('AFTER_FINAL_TYPED_ARRAYS');

  const sortedTripCounts = [...tripCountsPerPattern].toSorted(
    (left, right) => left - right,
  );
  const finalConcreteTrips =
    scheduledConcreteTrips + generatedFrequencyTrips;
  const statistics: RaptorTimetableBuildStatistics = {
    inputRetainedTrips,
    inputStopTimeCount,
    inputFrequencyWindowCount,
    scheduledConcreteTrips,
    frequencyTemplates,
    generatedFrequencyTrips,
    frequencyInstancesExcludedBeforeDeparture,
    finalConcreteTrips,
    activeNumericStops: denseStopIds.sourceStopIds.length,
    baseRoutePatterns:
      patterns.length - additionalPatternsCreatedBySplitting,
    finalNonOvertakingRoutePatterns: patterns.length,
    basePatternsRequiringOvertakingSplits,
    additionalPatternsCreatedBySplitting,
    maximumSplitCountForOneBasePattern,
    stopTimeEntries,
    minimumTripsPerPattern: sortedTripCounts[0] ?? 0,
    medianTripsPerPattern: calculateMedian(sortedTripCounts),
    maximumTripsPerPattern:
      sortedTripCounts[sortedTripCounts.length - 1] ?? 0,
    overtakingSplitExamples,
  };

  partitionedGroups.forEach(({ chains }) => {
    chains.forEach((chain) => {
      chain.length = 0;
    });
    chains.length = 0;
  });
  partitionedGroups.length = 0;
  tripCountsPerPattern.length = 0;
  sortedTripCounts.length = 0;
  denseStopIds.stopIndexBySourceId.clear();
  options.onStage?.('AFTER_TEMPORARY_BUILDERS_RELEASED');
  options.onStatistics?.(statistics);

  return {
    sourceStopIds: denseStopIds.sourceStopIds,
    patterns,
    patternOccurrencesByStop,
    transfersByStop: Array.from(
      { length: denseStopIds.sourceStopIds.length },
      () => new Uint32Array(),
    ),
  };
};
