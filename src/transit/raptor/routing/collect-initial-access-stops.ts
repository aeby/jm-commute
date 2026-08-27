import { USE_QUERY_TRANSFER_TIME } from '../transfers';
import { createUnreachedArrivalTimes, UNREACHED_TIME } from './state';
import type { InitialAccessResult, InitialAccessStop } from './types';

export interface InitialAccessScratch {
  readonly arrivalTimes: Uint32Array;
  readonly touchedStops: number[];
  readonly originalMembership: Uint8Array;
  readonly previousOriginalStops: number[];
}

export const createInitialAccessScratch = (
  stopCount: number,
): InitialAccessScratch => ({
  arrivalTimes: createUnreachedArrivalTimes(stopCount),
  touchedStops: [],
  originalMembership: new Uint8Array(stopCount),
  previousOriginalStops: [],
});

/**
 * Seeds the original stops and follows at most one access-eligible edge from
 * each original stop. Access destinations are never expanded recursively.
 */
export const collectInitialAccessStops = (
  accessTransfersByStop: readonly Uint32Array[],
  originStopIndexes: readonly number[],
  departureTimeSeconds: number,
  fallbackTransferTimeSeconds: number,
  maxArrivalTime: number,
  reusableScratch?: InitialAccessScratch,
): InitialAccessResult => {
  const stopCount = accessTransfersByStop.length;
  const scratch =
    reusableScratch ?? createInitialAccessScratch(stopCount);
  if (
    scratch.arrivalTimes.length !== stopCount ||
    scratch.originalMembership.length !== stopCount
  ) {
    throw new Error('Initial-access scratch does not match the stop count.');
  }
  const { arrivalTimes, originalMembership, touchedStops } = scratch;
  for (const stopIndex of touchedStops) {
    arrivalTimes[stopIndex] = UNREACHED_TIME;
  }
  touchedStops.length = 0;
  for (const stopIndex of scratch.previousOriginalStops) {
    originalMembership[stopIndex] = 0;
  }
  scratch.previousOriginalStops.length = 0;

  for (const originStopIndex of originStopIndexes) {
    if (
      !Number.isInteger(originStopIndex) ||
      originStopIndex < 0 ||
      originStopIndex >= stopCount
    ) {
      throw new RangeError(`Invalid initial-access origin ${originStopIndex}.`);
    }
    if (originalMembership[originStopIndex] !== 0) {
      continue;
    }
    originalMembership[originStopIndex] = 1;
    scratch.previousOriginalStops.push(originStopIndex);
    touchedStops.push(originStopIndex);
    arrivalTimes[originStopIndex] = departureTimeSeconds;
  }

  let edgesExamined = 0;
  let arrivalImprovements = 0;
  for (const originStopIndex of scratch.previousOriginalStops) {
    const edges = accessTransfersByStop[originStopIndex];
    if (edges === undefined || edges.length % 2 !== 0) {
      throw new Error(
        `Initial-access adjacency for stop ${originStopIndex} must contain pairs.`,
      );
    }
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 2) {
      const destinationStopIndex = edges[edgeIndex];
      const encodedDuration = edges[edgeIndex + 1];
      if (
        destinationStopIndex === undefined ||
        encodedDuration === undefined ||
        destinationStopIndex >= stopCount
      ) {
        throw new Error('Initial-access adjacency contains an invalid pair.');
      }
      edgesExamined += 1;
      const duration =
        encodedDuration === USE_QUERY_TRANSFER_TIME
          ? fallbackTransferTimeSeconds
          : encodedDuration;
      if (duration > maxArrivalTime - departureTimeSeconds) {
        continue;
      }
      const arrivalTimeSeconds = departureTimeSeconds + duration;
      if (
        arrivalTimeSeconds <
        (arrivalTimes[destinationStopIndex] ?? UNREACHED_TIME)
      ) {
        if (arrivalTimes[destinationStopIndex] === UNREACHED_TIME) {
          touchedStops.push(destinationStopIndex);
        }
        arrivalTimes[destinationStopIndex] = arrivalTimeSeconds;
        arrivalImprovements += 1;
      }
    }
  }

  const stops: InitialAccessStop[] = [];
  let additionalStopCount = 0;
  for (const stopIndex of touchedStops.toSorted((left, right) => left - right)) {
    const arrivalTimeSeconds = arrivalTimes[stopIndex];
    if (
      arrivalTimeSeconds === undefined ||
      arrivalTimeSeconds === UNREACHED_TIME
    ) {
      continue;
    }
    stops.push({ stopIndex, arrivalTimeSeconds });
    if (originalMembership[stopIndex] === 0) {
      additionalStopCount += 1;
    }
  }
  return {
    stops,
    originalStopCount: scratch.previousOriginalStops.length,
    additionalStopCount,
    edgesExamined,
    arrivalImprovements,
  };
};
