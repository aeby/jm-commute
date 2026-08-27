import {
  buildPatternAdjacency,
  encodePickupDropOffTypes,
  type RaptorRoutePattern,
  type RaptorTimetable,
} from '../../timetable';
import type { PickupDropOffType } from '../../../routing-data';

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
});
