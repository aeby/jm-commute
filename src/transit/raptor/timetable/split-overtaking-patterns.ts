import type { GroupedConcreteTrip } from './group-route-patterns';

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareTrips = (
  left: GroupedConcreteTrip,
  right: GroupedConcreteTrip,
): number =>
  (left.stopTimes[1] ?? 0) - (right.stopTimes[1] ?? 0) ||
  compareStrings(left.temporaryTripId, right.temporaryTripId);

const validateTripShape = (
  trip: GroupedConcreteTrip,
  stopCount: number,
): void => {
  if (trip.stopTimes.length !== stopCount * 2) {
    throw new Error(
      `Trip ${trip.temporaryTripId} has ${trip.stopTimes.length / 2} stop-time entries; expected ${stopCount}`,
    );
  }
};

export const tripPrecedesAtEveryStop = (
  earlier: GroupedConcreteTrip,
  later: GroupedConcreteTrip,
  stopCount: number,
): boolean => {
  validateTripShape(earlier, stopCount);
  validateTripShape(later, stopCount);

  for (let stopIndex = 0; stopIndex < stopCount; stopIndex += 1) {
    const timeIndex = stopIndex * 2;
    const earlierArrival = earlier.stopTimes[timeIndex];
    const earlierDeparture = earlier.stopTimes[timeIndex + 1];
    const laterArrival = later.stopTimes[timeIndex];
    const laterDeparture = later.stopTimes[timeIndex + 1];

    if (
      earlierArrival === undefined ||
      earlierDeparture === undefined ||
      laterArrival === undefined ||
      laterDeparture === undefined
    ) {
      throw new Error('A route-pattern trip is missing a stop time');
    }

    if (
      earlierArrival > laterArrival ||
      earlierDeparture > laterDeparture
    ) {
      return false;
    }
  }

  return true;
};

export const validateNonOvertakingTripChain = (
  trips: readonly GroupedConcreteTrip[],
  stopCount: number,
): void => {
  trips.forEach((trip) => validateTripShape(trip, stopCount));
  for (let tripIndex = 1; tripIndex < trips.length; tripIndex += 1) {
    const previous = trips[tripIndex - 1];
    const current = trips[tripIndex];
    if (
      previous === undefined ||
      current === undefined ||
      !tripPrecedesAtEveryStop(previous, current, stopCount)
    ) {
      throw new Error(
        `Trips at indexes ${tripIndex - 1} and ${tripIndex} overtake within a route pattern`,
      );
    }
  }
};

/**
 * Greedily partitions departure-sorted trips into deterministic non-overtaking
 * chains. Compatible chains with the latest preceding first departure win.
 */
export const splitOvertakingTrips = (
  trips: readonly GroupedConcreteTrip[],
  stopCount: number,
): readonly GroupedConcreteTrip[][] => {
  if (!Number.isInteger(stopCount) || stopCount <= 0) {
    throw new RangeError('stopCount must be a positive integer');
  }

  const sortedTrips = [...trips].toSorted(compareTrips);
  const chains: GroupedConcreteTrip[][] = [];

  for (const trip of sortedTrips) {
    validateTripShape(trip, stopCount);
    let selectedChainIndex: number | undefined;
    let selectedLastFirstDeparture = -1;

    for (let chainIndex = 0; chainIndex < chains.length; chainIndex += 1) {
      const chain = chains[chainIndex];
      const lastTrip = chain?.[chain.length - 1];
      if (
        lastTrip === undefined ||
        !tripPrecedesAtEveryStop(lastTrip, trip, stopCount)
      ) {
        continue;
      }

      const lastFirstDeparture = lastTrip.stopTimes[1] ?? 0;
      if (
        selectedChainIndex === undefined ||
        lastFirstDeparture > selectedLastFirstDeparture
      ) {
        selectedChainIndex = chainIndex;
        selectedLastFirstDeparture = lastFirstDeparture;
      }
    }

    if (selectedChainIndex === undefined) {
      chains.push([trip]);
    } else {
      chains[selectedChainIndex]?.push(trip);
    }
  }

  chains.forEach((chain) =>
    validateNonOvertakingTripChain(chain, stopCount),
  );
  return chains;
};
