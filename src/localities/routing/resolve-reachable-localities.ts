import {
  UNREACHED_TIME,
  type FastestWindowResult,
} from '../../transit/raptor';
import type { LocalityId } from '../types';
import type {
  LocalityRoutingIndex,
  ReachableLocality,
  ReachableLocalityDebug,
} from './types';

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function compareReachableLocalities(
  left: ReachableLocality,
  right: ReachableLocality,
): number {
  const travelDifference = left.travelMinutes - right.travelMinutes;
  return travelDifference !== 0
    ? travelDifference
    : compareStrings(left.localityId, right.localityId);
}

export function createReachableLocalityMap(
  reachable: readonly ReachableLocality[],
): ReadonlyMap<LocalityId, number> {
  const travelMinutesByLocalityId = new Map<LocalityId, number>();
  for (const locality of reachable) {
    if (travelMinutesByLocalityId.has(locality.localityId)) {
      throw new Error(`Duplicate reachable locality "${locality.localityId}".`);
    }
    travelMinutesByLocalityId.set(
      locality.localityId,
      locality.travelMinutes,
    );
  }
  return travelMinutesByLocalityId;
}

const validateFastestResultLengths = (
  result: FastestWindowResult,
): void => {
  if (
    result.departureTimes.length !== result.durationSeconds.length ||
    result.arrivalTimes.length !== result.durationSeconds.length
  ) {
    throw new Error(
      'Fastest-window duration, departure, and arrival arrays must have equal lengths.',
    );
  }
};

export function resolveFastestReachableLocalitiesDebug(
  routingResult: FastestWindowResult,
  localityIndex: LocalityRoutingIndex,
): readonly ReachableLocalityDebug[] {
  validateFastestResultLengths(routingResult);
  const reachable: ReachableLocalityDebug[] = [];

  for (const entry of localityIndex.entries) {
    let bestStopIndex: number | undefined;
    for (const stopIndex of entry.stopIndexes) {
      if (stopIndex >= routingResult.durationSeconds.length) {
        throw new RangeError(
          `Locality routing entry "${entry.localityId}" references stop index ${stopIndex}, but the fastest-window result has ${routingResult.durationSeconds.length} stops.`,
        );
      }
      const duration =
        routingResult.durationSeconds[stopIndex] ?? UNREACHED_TIME;
      if (duration === UNREACHED_TIME) {
        continue;
      }
      if (bestStopIndex === undefined) {
        bestStopIndex = stopIndex;
        continue;
      }
      const bestDuration =
        routingResult.durationSeconds[bestStopIndex] ?? UNREACHED_TIME;
      const departure =
        routingResult.departureTimes[stopIndex] ?? UNREACHED_TIME;
      const bestDeparture =
        routingResult.departureTimes[bestStopIndex] ?? UNREACHED_TIME;
      const arrival = routingResult.arrivalTimes[stopIndex] ?? UNREACHED_TIME;
      const bestArrival =
        routingResult.arrivalTimes[bestStopIndex] ?? UNREACHED_TIME;
      if (
        duration < bestDuration ||
        (duration === bestDuration &&
          (departure > bestDeparture ||
            (departure === bestDeparture && arrival < bestArrival)))
      ) {
        bestStopIndex = stopIndex;
      }
    }

    if (bestStopIndex === undefined) {
      continue;
    }
    const durationSeconds =
      routingResult.durationSeconds[bestStopIndex] ?? UNREACHED_TIME;
    const departureTimeSeconds =
      routingResult.departureTimes[bestStopIndex] ?? UNREACHED_TIME;
    const arrivalTimeSeconds =
      routingResult.arrivalTimes[bestStopIndex] ?? UNREACHED_TIME;
    if (
      durationSeconds === UNREACHED_TIME ||
      departureTimeSeconds === UNREACHED_TIME ||
      arrivalTimeSeconds === UNREACHED_TIME ||
      arrivalTimeSeconds - departureTimeSeconds !== durationSeconds
    ) {
      throw new Error(
        `Fastest-window result is inconsistent for locality "${entry.localityId}".`,
      );
    }
    reachable.push({
      localityId: entry.localityId,
      travelMinutes: Math.ceil(durationSeconds / 60),
      departureTimeSeconds,
      arrivalTimeSeconds,
    });
  }

  return reachable.toSorted(compareReachableLocalities);
}

export function resolveFastestReachableLocalities(
  routingResult: FastestWindowResult,
  localityIndex: LocalityRoutingIndex,
): readonly ReachableLocality[] {
  return resolveFastestReachableLocalitiesDebug(
    routingResult,
    localityIndex,
  ).map(({ localityId, travelMinutes }) => ({ localityId, travelMinutes }));
}
