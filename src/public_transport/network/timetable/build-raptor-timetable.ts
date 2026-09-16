import type { RoutingTrip } from '../../prepare/routing';
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
  RaptorRoutePattern,
  RaptorTimetable,
} from './types';

interface PartitionedRoutePatternGroup {
  readonly routeId: string;
  readonly numericStops: Uint32Array;
  readonly chains: GroupedConcreteTrip[][];
}

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
  routeId: string,
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
    routeId,
    stops,
    stopTimes,
    pickupDropOffTypes,
    tripCount: trips.length,
  };
};

export const buildRaptorTimetable = async (
  routingTrips: Iterable<RoutingTrip> | AsyncIterable<RoutingTrip>,
  routingWindowStartSeconds: number,
): Promise<RaptorTimetable> => {
  const grouper = new BaseRoutePatternGrouper();
  const sourceStopIdSet = new Set<string>();
  const inputTripIds = new Set<string>();

  const addConcreteTrip = (trip: ExpandedConcreteTrip): void => {
    trip.sourceStopIds.forEach((stopId) => sourceStopIdSet.add(stopId));
    grouper.add(trip);
  };

  for await (const routingTrip of routingTrips) {
    if (inputTripIds.has(routingTrip.tripId)) {
      throw new Error(`Duplicate routing trip ID ${routingTrip.tripId}`);
    }
    inputTripIds.add(routingTrip.tripId);
    expandRoutingTrip(
      routingTrip,
      routingWindowStartSeconds,
      addConcreteTrip,
    );
  }

  const baseGroups = grouper.finish();
  const denseStopIds = buildDenseStopIds(sourceStopIdSet);

  const partitionedGroups: PartitionedRoutePatternGroup[] = [];

  for (const group of baseGroups) {
    const chains = splitOvertakingTrips(
      group.trips,
      group.sourceStopIds.length,
    ).map((chain) => [...chain]);
    partitionedGroups.push({
      routeId: group.routeId,
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

  const patterns: RaptorRoutePattern[] = [];
  partitionedGroups.forEach(({ routeId, numericStops, chains }) => {
    chains.forEach((chain) => {
      patterns.push(buildTypedPattern(routeId, numericStops, chain));
    });
  });
  const patternOccurrencesByStop = buildPatternAdjacency(
    patterns,
    denseStopIds.sourceStopIds.length,
  );

  partitionedGroups.forEach(({ chains }) => {
    chains.forEach((chain) => {
      chain.length = 0;
    });
    chains.length = 0;
  });
  partitionedGroups.length = 0;
  denseStopIds.stopIndexBySourceId.clear();

  return {
    sourceStopIds: denseStopIds.sourceStopIds,
    patterns,
    patternOccurrencesByStop,
  };
};
