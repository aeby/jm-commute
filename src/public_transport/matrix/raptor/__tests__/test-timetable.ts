import { buildPatternAdjacency } from '../../../network/timetable/build-pattern-adjacency';
import { encodePickupDropOffTypes } from '../../../network/timetable/pickup-dropoff-codec';
import type {
  PublicTransportNetwork,
  RaptorRoutePattern,
} from '../../../network/timetable/types';
import type { PickupDropOffType } from '../../../prepare/gtfs';
import { collectValidatedOriginDepartureSlots } from '../collect-origin-departure-slots';
import {
  createRaptorRunBuffers,
  runValidatedRaptorOneToAllBorrowed,
} from '../run-raptor-one-to-all';
import { UNREACHED_TIME } from '../state';
import { validateOriginDepartureInputs } from '../validate-query';

export interface TestRaptorQuery {
  readonly originStopIndexes: readonly number[];
  readonly departureTimeSeconds: number;
  readonly maxTravelTimeSeconds: number;
  readonly maxTransfers: number;
  readonly minTransferTimeSeconds: number;
}

export interface TestRaptorResult {
  readonly departureTimeSeconds: number;
  readonly arrivalTimes: Uint32Array;
}

export const arrivalAt = (
  result: TestRaptorResult,
  stopIndex: number,
): number | undefined => {
  if (
    !Number.isInteger(stopIndex) ||
    stopIndex < 0 ||
    stopIndex >= result.arrivalTimes.length
  ) {
    throw new RangeError(`Invalid RAPTOR result stop index ${stopIndex}`);
  }
  const arrivalTime = result.arrivalTimes[stopIndex];
  return arrivalTime === UNREACHED_TIME ? undefined : arrivalTime;
};

export const travelTimeTo = (
  result: TestRaptorResult,
  stopIndex: number,
): number | undefined => {
  const arrivalTime = arrivalAt(result, stopIndex);
  return arrivalTime === undefined
    ? undefined
    : arrivalTime - result.departureTimeSeconds;
};

/** Test-only adapter for exercising one validated departure independently. */
export const runRaptorOneToAll = (
  timetable: PublicTransportNetwork,
  query: TestRaptorQuery,
): TestRaptorResult =>
  runValidatedRaptorOneToAllBorrowed(
    timetable,
    {
      originStopIndexes: [...new Set(query.originStopIndexes)],
      departureTimeSeconds: query.departureTimeSeconds,
      maxArrivalTime:
        query.departureTimeSeconds + query.maxTravelTimeSeconds,
      maxTransfers: query.maxTransfers,
      minTransferTimeSeconds: query.minTransferTimeSeconds,
    },
    createRaptorRunBuffers(timetable),
  );

/** Test-only adapter around the validated departure-slot collector. */
export const collectOriginDepartureSlots = (
  timetable: PublicTransportNetwork,
  originStopIndexes: readonly number[],
  windowStartSeconds: number,
  windowEndSeconds: number,
  minTransferTimeSeconds: number,
): Uint32Array =>
  collectValidatedOriginDepartureSlots(
    timetable,
    validateOriginDepartureInputs(
      timetable,
      originStopIndexes,
      windowStartSeconds,
      windowEndSeconds,
      minTransferTimeSeconds,
    ),
  );

export interface TestStopTime {
  readonly arrival: number;
  readonly departure: number;
  readonly pickupType?: PickupDropOffType;
  readonly dropOffType?: PickupDropOffType;
}

export const testPattern = (
  stops: readonly number[],
  trips: readonly (readonly TestStopTime[])[],
): RaptorRoutePattern => {
  if (trips.some((trip) => trip.length !== stops.length)) {
    throw new Error('Every test trip must match the pattern stop count');
  }

  const stopTimes = new Uint32Array(trips.length * stops.length * 2);
  const pickupDropOffEntries: {
    pickupType: PickupDropOffType;
    dropOffType: PickupDropOffType;
  }[] = [];
  trips.forEach((trip, tripIndex) => {
    trip.forEach((stopTime, stopIndex) => {
      const entryIndex = tripIndex * stops.length + stopIndex;
      stopTimes[entryIndex * 2] = stopTime.arrival;
      stopTimes[entryIndex * 2 + 1] = stopTime.departure;
      pickupDropOffEntries.push({
        pickupType: stopTime.pickupType ?? 0,
        dropOffType: stopTime.dropOffType ?? 0,
      });
    });
  });

  return {
    routeId: 'test-route',
    stops: new Uint32Array(stops),
    stopTimes,
    pickupDropOffTypes: encodePickupDropOffTypes(pickupDropOffEntries),
    tripCount: trips.length,
  };
};

export const testTimetable = (
  stopCount: number,
  patterns: readonly RaptorRoutePattern[],
): PublicTransportNetwork => ({
  sourceStopIds: Array.from(
    { length: stopCount },
    (_, stopIndex) => `stop-${stopIndex}`,
  ),
  patterns,
  routingWindowStartSeconds: 7 * 60 * 60,
  routingWindowEndSeconds: 9 * 60 * 60,
  patternOccurrencesByStop: buildPatternAdjacency(patterns, stopCount),
  transfersByStop: Array.from(
    { length: stopCount },
    () => new Uint32Array(),
  ),
  accessTransfersByStop: Array.from(
    { length: stopCount },
    () => new Uint32Array(),
  ),
});
