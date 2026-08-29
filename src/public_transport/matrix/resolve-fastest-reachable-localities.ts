import type { ReachableLocality } from '@jm/commute';
import type {
  LocalityRoutingStopEntry,
  LocalityRoutingStopIndex,
} from '../network/localities/types';
import { isPreferredFastestJourney } from './raptor/fastest-journey-policy';
import { UNREACHED_TIME } from './raptor/state';
import type { FastestWindowResult } from './raptor/types';

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

function validateFastestResultLengths(result: FastestWindowResult): void {
  if (
    result.departureTimes.length !== result.durationSeconds.length ||
    result.arrivalTimes.length !== result.durationSeconds.length
  ) {
    throw new Error(
      'Fastest-window duration, departure, and arrival arrays must have equal lengths.',
    );
  }
}

interface FastestLocalityJourney {
  readonly durationSeconds: number;
  readonly departureTimeSeconds: number;
  readonly arrivalTimeSeconds: number;
}

function findFastestLocalityJourney(
  routingResult: FastestWindowResult,
  entry: LocalityRoutingStopEntry,
): FastestLocalityJourney | undefined {
  let best: FastestLocalityJourney | undefined;

  for (const stopIndex of entry.stopIndexes) {
    if (stopIndex >= routingResult.durationSeconds.length) {
      throw new RangeError(
        `Locality routing entry "${entry.localityId}" references stop index ${stopIndex}, but the fastest-window result has ${routingResult.durationSeconds.length} stops.`,
      );
    }

    const durationSeconds =
      routingResult.durationSeconds[stopIndex] ?? UNREACHED_TIME;
    if (durationSeconds === UNREACHED_TIME) {
      continue;
    }

    const departureTimeSeconds =
      routingResult.departureTimes[stopIndex] ?? UNREACHED_TIME;
    const arrivalTimeSeconds =
      routingResult.arrivalTimes[stopIndex] ?? UNREACHED_TIME;
    if (
      departureTimeSeconds === UNREACHED_TIME ||
      arrivalTimeSeconds === UNREACHED_TIME ||
      arrivalTimeSeconds - departureTimeSeconds !== durationSeconds
    ) {
      throw new Error(
        `Fastest-window result is inconsistent for locality "${entry.localityId}".`,
      );
    }

    if (
      best === undefined ||
      isPreferredFastestJourney(
        durationSeconds,
        departureTimeSeconds,
        arrivalTimeSeconds,
        best.durationSeconds,
        best.departureTimeSeconds,
        best.arrivalTimeSeconds,
      )
    ) {
      best = {
        durationSeconds,
        departureTimeSeconds,
        arrivalTimeSeconds,
      };
    }
  }

  return best;
}

export function resolveFastestReachableLocalities(
  routingResult: FastestWindowResult,
  localityIndex: LocalityRoutingStopIndex,
): readonly ReachableLocality[] {
  validateFastestResultLengths(routingResult);
  const reachable: ReachableLocality[] = [];

  for (const entry of localityIndex.entries) {
    const journey = findFastestLocalityJourney(routingResult, entry);
    if (journey !== undefined) {
      reachable.push({
        localityId: entry.localityId,
        travelMinutes: Math.ceil(journey.durationSeconds / 60),
      });
    }
  }

  return reachable.toSorted(compareReachableLocalities);
}
