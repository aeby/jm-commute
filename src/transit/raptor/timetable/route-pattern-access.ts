import type { PickupDropOffType } from '../../routing-data';
import {
  getPackedDropOffType,
  getPackedPickupType,
} from './pickup-dropoff-codec';
import type { RaptorRoutePattern } from './types';

const validatePatternShape = (pattern: RaptorRoutePattern): void => {
  const entryCount = pattern.tripCount * pattern.stops.length;
  if (pattern.stopTimes.length !== entryCount * 2) {
    throw new Error('Route pattern has an inconsistent stop-times array');
  }
  if (pattern.pickupDropOffTypes.length !== Math.ceil(entryCount / 2)) {
    throw new Error(
      'Route pattern has an inconsistent pickup/drop-off array',
    );
  }
};

const validateIndexes = (
  pattern: RaptorRoutePattern,
  stopIndex: number,
  tripIndex: number,
): void => {
  validatePatternShape(pattern);
  if (
    !Number.isInteger(stopIndex) ||
    stopIndex < 0 ||
    stopIndex >= pattern.stops.length
  ) {
    throw new RangeError(`Invalid route-pattern stop index ${stopIndex}`);
  }
  if (
    !Number.isInteger(tripIndex) ||
    tripIndex < 0 ||
    tripIndex >= pattern.tripCount
  ) {
    throw new RangeError(`Invalid route-pattern trip index ${tripIndex}`);
  }
};

const getStopEntryIndex = (
  pattern: RaptorRoutePattern,
  stopIndex: number,
  tripIndex: number,
): number => {
  validateIndexes(pattern, stopIndex, tripIndex);
  return tripIndex * pattern.stops.length + stopIndex;
};

export const getArrivalTime = (
  pattern: RaptorRoutePattern,
  stopIndex: number,
  tripIndex: number,
): number => {
  const entryIndex = getStopEntryIndex(pattern, stopIndex, tripIndex);
  const arrival = pattern.stopTimes[entryIndex * 2];
  if (arrival === undefined) {
    throw new Error('Route-pattern arrival time is missing');
  }
  return arrival;
};

export const getDepartureTime = (
  pattern: RaptorRoutePattern,
  stopIndex: number,
  tripIndex: number,
): number => {
  const entryIndex = getStopEntryIndex(pattern, stopIndex, tripIndex);
  const departure = pattern.stopTimes[entryIndex * 2 + 1];
  if (departure === undefined) {
    throw new Error('Route-pattern departure time is missing');
  }
  return departure;
};

export const getPickupType = (
  pattern: RaptorRoutePattern,
  stopIndex: number,
  tripIndex: number,
): PickupDropOffType => {
  const entryIndex = getStopEntryIndex(pattern, stopIndex, tripIndex);
  return getPackedPickupType(pattern.pickupDropOffTypes, entryIndex);
};

export const getDropOffType = (
  pattern: RaptorRoutePattern,
  stopIndex: number,
  tripIndex: number,
): PickupDropOffType => {
  const entryIndex = getStopEntryIndex(pattern, stopIndex, tripIndex);
  return getPackedDropOffType(pattern.pickupDropOffTypes, entryIndex);
};

/**
 * Finds the first trip departing no earlier than the requested time. The
 * optional trip bound is exclusive, matching the later RAPTOR scan upgrade.
 */
export const findEarliestTripAtOrAfter = (
  pattern: RaptorRoutePattern,
  stopIndex: number,
  earliestDepartureSeconds: number,
  beforeTripIndex?: number,
): number | undefined => {
  validatePatternShape(pattern);
  if (
    !Number.isInteger(stopIndex) ||
    stopIndex < 0 ||
    stopIndex >= pattern.stops.length
  ) {
    throw new RangeError(`Invalid route-pattern stop index ${stopIndex}`);
  }
  if (
    !Number.isInteger(earliestDepartureSeconds) ||
    earliestDepartureSeconds < 0
  ) {
    throw new RangeError(
      'earliestDepartureSeconds must be a nonnegative integer',
    );
  }

  const upperBound = beforeTripIndex ?? pattern.tripCount;
  if (
    !Number.isInteger(upperBound) ||
    upperBound < 0 ||
    upperBound > pattern.tripCount
  ) {
    throw new RangeError(
      `beforeTripIndex must be between 0 and ${pattern.tripCount}`,
    );
  }

  let low = 0;
  let high = upperBound;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const departureIndex =
      (middle * pattern.stops.length + stopIndex) * 2 + 1;
    const departure = pattern.stopTimes[departureIndex];
    if (departure === undefined) {
      throw new Error('Route-pattern departure time is missing');
    }
    if (departure < earliestDepartureSeconds) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low < upperBound ? low : undefined;
};
