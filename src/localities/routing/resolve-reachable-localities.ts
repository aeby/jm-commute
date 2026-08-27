import { UNREACHED_TIME, type RaptorResult } from '../../transit/raptor';
import type { LocalityId } from '../types';
import type {
  LocalityRoutingIndex,
  ReachableLocality,
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

export function resolveReachableLocalities(
  routingResult: RaptorResult,
  localityIndex: LocalityRoutingIndex,
): readonly ReachableLocality[] {
  const reachable: ReachableLocality[] = [];

  for (const entry of localityIndex.entries) {
    let earliestArrival = UNREACHED_TIME;

    for (const stopIndex of entry.stopIndexes) {
      if (stopIndex >= routingResult.arrivalTimes.length) {
        throw new RangeError(
          `Locality routing entry "${entry.localityId}" references stop index ${stopIndex}, but the RAPTOR result has ${routingResult.arrivalTimes.length} stops.`,
        );
      }
      const arrival = routingResult.arrivalTimes[stopIndex] ?? UNREACHED_TIME;
      if (arrival < earliestArrival) {
        earliestArrival = arrival;
      }
    }

    if (earliestArrival === UNREACHED_TIME) {
      continue;
    }
    if (earliestArrival < routingResult.departureTimeSeconds) {
      throw new Error(
        `Locality routing entry "${entry.localityId}" arrives before the RAPTOR departure time.`,
      );
    }

    reachable.push({
      localityId: entry.localityId,
      travelMinutes: Math.ceil(
        (earliestArrival - routingResult.departureTimeSeconds) / 60,
      ),
    });
  }

  return reachable.toSorted(compareReachableLocalities);
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
