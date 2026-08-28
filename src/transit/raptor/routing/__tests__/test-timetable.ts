import { buildPatternAdjacency } from '../../timetable/build-pattern-adjacency';
import { encodePickupDropOffTypes } from '../../timetable/pickup-dropoff-codec';
import type {
  RaptorRoutePattern,
  RaptorTimetable,
} from '../../timetable/types';
import type { PickupDropOffType } from '../../../gtfs';
import { runRaptorOneToAll } from '../run-raptor-one-to-all';
import { UNREACHED_TIME } from '../state';
import type { RaptorResult } from '../types';

export const arrivalAt = (
  result: RaptorResult,
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
  result: RaptorResult,
  stopIndex: number,
): number | undefined => {
  const arrivalTime = arrivalAt(result, stopIndex);
  return arrivalTime === undefined
    ? undefined
    : arrivalTime - result.departureTimeSeconds;
};

export { runRaptorOneToAll };

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
    stops: new Uint32Array(stops),
    stopTimes,
    pickupDropOffTypes: encodePickupDropOffTypes(pickupDropOffEntries),
    tripCount: trips.length,
  };
};

export const testTimetable = (
  stopCount: number,
  patterns: readonly RaptorRoutePattern[],
): RaptorTimetable => ({
  sourceStopIds: Array.from(
    { length: stopCount },
    (_, stopIndex) => `stop-${stopIndex}`,
  ),
  patterns,
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
