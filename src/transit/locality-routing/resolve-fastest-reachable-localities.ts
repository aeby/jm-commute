import type { ReachableLocality } from '../../localities';
import { isPreferredFastestJourney } from '../raptor/routing/fastest-journey-policy';
import { UNREACHED_TIME } from '../raptor/routing/state';
import type { FastestWindowResult } from '../raptor/routing/types';
import type {
  RuntimeLocalityRoutingEntry,
  RuntimeLocalityRoutingIndex,
} from './runtime-types';

export interface ReachableLocalityDebug extends ReachableLocality {
  readonly departureTimeSeconds: number;
  readonly arrivalTimeSeconds: number;
}

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
  entry: RuntimeLocalityRoutingEntry,
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

function resolveLocalities<TResult extends ReachableLocality>(
  routingResult: FastestWindowResult,
  localityIndex: RuntimeLocalityRoutingIndex,
  createResult: (
    entry: RuntimeLocalityRoutingEntry,
    journey: FastestLocalityJourney,
  ) => TResult,
): readonly TResult[] {
  validateFastestResultLengths(routingResult);
  const reachable: TResult[] = [];

  for (const entry of localityIndex.entries) {
    const journey = findFastestLocalityJourney(routingResult, entry);
    if (journey !== undefined) {
      reachable.push(createResult(entry, journey));
    }
  }

  return reachable.toSorted(compareReachableLocalities);
}

export function resolveFastestReachableLocalities(
  routingResult: FastestWindowResult,
  localityIndex: RuntimeLocalityRoutingIndex,
): readonly ReachableLocality[] {
  return resolveLocalities(routingResult, localityIndex, (entry, journey) => ({
    localityId: entry.localityId,
    travelMinutes: Math.ceil(journey.durationSeconds / 60),
  }));
}

export function resolveFastestReachableLocalitiesDebug(
  routingResult: FastestWindowResult,
  localityIndex: RuntimeLocalityRoutingIndex,
): readonly ReachableLocalityDebug[] {
  return resolveLocalities(routingResult, localityIndex, (entry, journey) => ({
    localityId: entry.localityId,
    travelMinutes: Math.ceil(journey.durationSeconds / 60),
    departureTimeSeconds: journey.departureTimeSeconds,
    arrivalTimeSeconds: journey.arrivalTimeSeconds,
  }));
}
