import {
  findEarliestTripAtOrAfter,
  getArrivalTime,
  getDepartureTime,
  getDropOffType,
  getPickupType,
  type RaptorRoutePattern,
} from '../timetable';
import { resolveSameStopTransferTime } from './relax-transfers';
import {
  improveSharedBoardingReadyTime,
  improveSharedVehicleArrival,
  UNREACHED_TIME,
  type PatternScanState,
} from './state';

const findBoardableTrip = (
  pattern: RaptorRoutePattern,
  stopIndex: number,
  earliestBoardingTime: number,
  activeTripIndex: number | undefined,
  maxArrivalTime: number,
): number | undefined => {
  const exclusiveUpperBound = activeTripIndex ?? pattern.tripCount;
  let candidateTripIndex = findEarliestTripAtOrAfter(
    pattern,
    stopIndex,
    earliestBoardingTime,
    exclusiveUpperBound,
  );

  while (
    candidateTripIndex !== undefined &&
    candidateTripIndex < exclusiveUpperBound &&
    getPickupType(pattern, stopIndex, candidateTripIndex) === 1
  ) {
    candidateTripIndex += 1;
  }

  if (
    candidateTripIndex === undefined ||
    candidateTripIndex >= exclusiveUpperBound
  ) {
    return undefined;
  }

  return getDepartureTime(pattern, stopIndex, candidateTripIndex) <=
    maxArrivalTime
    ? candidateTripIndex
    : undefined;
};

/** Scans one non-overtaking route pattern for a single RAPTOR round. */
export const scanPattern = (
  pattern: RaptorRoutePattern,
  firstStopIndex: number,
  state: PatternScanState,
): number => {
  if (
    !Number.isInteger(firstStopIndex) ||
    firstStopIndex < 0 ||
    firstStopIndex >= pattern.stops.length
  ) {
    throw new RangeError(`Invalid first route-pattern stop ${firstStopIndex}`);
  }

  let activeTripIndex: number | undefined;
  let stopsImproved = 0;

  for (
    let stopIndex = firstStopIndex;
    stopIndex < pattern.stops.length;
    stopIndex += 1
  ) {
    const numericStopId = pattern.stops[stopIndex];
    if (numericStopId === undefined) {
      throw new Error(`Route pattern has no stop at index ${stopIndex}`);
    }

    if (activeTripIndex !== undefined) {
      const arrivalTime = getArrivalTime(
        pattern,
        stopIndex,
        activeTripIndex,
      );
      if (
        getDropOffType(pattern, stopIndex, activeTripIndex) !== 1 &&
        arrivalTime <= state.maxArrivalTime
      ) {
        if (
          arrivalTime <
          (state.globalArrivalTimes[numericStopId] ?? UNREACHED_TIME)
        ) {
          if (state.reachedMembership[numericStopId] === 0) {
            state.reachedMembership[numericStopId] = 1;
            state.reachedStops.push(numericStopId);
          }
          state.globalArrivalTimes[numericStopId] = arrivalTime;
          stopsImproved += 1;
        }
        if (
          improveSharedVehicleArrival(
            state.sharedRound,
            numericStopId,
            arrivalTime,
          ) &&
          arrivalTime <
          (state.bestVehicleArrivalTimes[numericStopId] ?? UNREACHED_TIME)
        ) {
          state.bestVehicleArrivalTimes[numericStopId] = arrivalTime;
          state.currentRoundVehicleArrivalTimes[numericStopId] = arrivalTime;
          if (state.vehicleImprovedMembership[numericStopId] === 0) {
            state.vehicleImprovedMembership[numericStopId] = 1;
            state.vehicleImprovedStops.push(numericStopId);
          }
        }
        const transfers = state.transfersByStop[numericStopId];
        if (transfers === undefined) {
          throw new Error(`Missing transfer adjacency for stop ${numericStopId}.`);
        }
        const sameStopTransferTime = resolveSameStopTransferTime(
          transfers,
          numericStopId,
          state.minTransferTimeSeconds,
        );
        const boardingReadyTime = arrivalTime + sameStopTransferTime;
        if (
          sameStopTransferTime <= state.maxArrivalTime - arrivalTime &&
          improveSharedBoardingReadyTime(
            state.sharedRound,
            numericStopId,
            boardingReadyTime,
          ) &&
          boardingReadyTime <
            (state.globalBoardingReadyTimes[numericStopId] ?? UNREACHED_TIME)
        ) {
          state.globalBoardingReadyTimes[numericStopId] = boardingReadyTime;
          state.currentRoundArrivalTimes[numericStopId] = arrivalTime;
          state.currentRoundTransferApplied[numericStopId] = 0;
          if (state.nextMarkedMembership[numericStopId] === 0) {
            state.nextMarkedMembership[numericStopId] = 1;
            state.nextMarkedStops.push(numericStopId);
          }
        }
      }
    }

    const previousRoundArrival =
      state.previousRoundArrivalTimes[numericStopId] ?? UNREACHED_TIME;
    if (previousRoundArrival === UNREACHED_TIME) {
      continue;
    }

    const arrivalAlreadyIncludesTransfer =
      state.previousRoundTransferApplied[numericStopId] === 1;
    const transfers = state.transfersByStop[numericStopId];
    if (transfers === undefined) {
      throw new Error(`Missing transfer adjacency for stop ${numericStopId}.`);
    }
    const transferTime =
      state.roundNumber === 1 || arrivalAlreadyIncludesTransfer
        ? 0
        : resolveSameStopTransferTime(
            transfers,
            numericStopId,
            state.minTransferTimeSeconds,
          );
    if (transferTime > state.maxArrivalTime - previousRoundArrival) {
      continue;
    }
    const earliestBoardingTime = previousRoundArrival + transferTime;
    const boardableTripIndex = findBoardableTrip(
      pattern,
      stopIndex,
      earliestBoardingTime,
      activeTripIndex,
      state.maxArrivalTime,
    );
    if (boardableTripIndex !== undefined) {
      activeTripIndex = boardableTripIndex;
    }
  }

  return stopsImproved;
};
