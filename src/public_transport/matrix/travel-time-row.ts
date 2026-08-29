import type { LocalityId, ReachableLocality } from '@jm/commute';
import {
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  UNAVAILABLE_TRAVEL_TIME,
} from '@commute-internal/travel-time-matrix';

export type TransitReachabilityQuery = (
  originLocalityId: LocalityId,
  maxTravelMinutes: number,
) => readonly ReachableLocality[];

function invalidQueryResult(detail: string): never {
  throw new Error(`Invalid transit reachability result: ${detail}.`);
}

function validateLocalityIds(
  localityIds: readonly LocalityId[],
): readonly LocalityId[] {
  if (!Array.isArray(localityIds) || localityIds.length === 0) {
    throw new Error('Transit matrix locality ordering must not be empty.');
  }
  const seen = new Set<string>();
  for (let index = 0; index < localityIds.length; index += 1) {
    const localityId = localityIds[index];
    if (
      typeof localityId !== 'string' ||
      localityId.length === 0 ||
      localityId.trim() !== localityId
    ) {
      throw new Error(
        `Transit matrix locality ID at index ${index} must be nonempty and canonical.`,
      );
    }
    if (seen.has(localityId)) {
      throw new Error(`Duplicate transit matrix locality "${localityId}".`);
    }
    const previousLocalityId = localityIds[index - 1];
    if (
      previousLocalityId !== undefined &&
      previousLocalityId > localityId
    ) {
      throw new Error(
        'Transit matrix locality IDs must use deterministic lexical order.',
      );
    }
    seen.add(localityId);
  }
  return Object.freeze([...localityIds]);
}

/**
 * Creates the deterministic one-row compiler used by public-transport matrix
 * generation. Stop-level RAPTOR details remain outside this module.
 */
export function createTransitTravelTimeMatrixRowGenerator(
  transitLocalityIds: readonly LocalityId[],
  queryReachableLocalities: TransitReachabilityQuery,
) {
  if (typeof queryReachableLocalities !== 'function') {
    throw new TypeError('Transit reachability query must be a function.');
  }

  const localityIds = validateLocalityIds(transitLocalityIds);
  const localityCount = localityIds.length;
  const localityIndexById = new Map(
    localityIds.map((localityId, index) => [localityId, index]),
  );

  return Object.freeze({
    generateRow(originIndex: number): Uint8Array {
      if (
        !Number.isSafeInteger(originIndex) ||
        originIndex < 0 ||
        originIndex >= localityCount
      ) {
        throw new RangeError(
          `Transit matrix origin index must be an integer from 0 to ${localityCount - 1}.`,
        );
      }
      const row = new Uint8Array(localityCount).fill(
        UNAVAILABLE_TRAVEL_TIME,
      );
      row[originIndex] = 0;

      const originLocalityId = localityIds[originIndex] as LocalityId;
      const reachable = queryReachableLocalities(
        originLocalityId,
        COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
      );
      if (!Array.isArray(reachable)) {
        return invalidQueryResult('expected an array');
      }

      const populatedDestinations = new Set<number>();
      for (let resultIndex = 0; resultIndex < reachable.length; resultIndex += 1) {
        const result = reachable[resultIndex];
        if (typeof result !== 'object' || result === null) {
          return invalidQueryResult(
            `entry ${resultIndex} must be a reachable-locality object`,
          );
        }
        const destinationIndex = localityIndexById.get(result.localityId);
        if (destinationIndex === undefined) {
          return invalidQueryResult(
            `entry ${resultIndex} references unknown locality ${JSON.stringify(result.localityId)}`,
          );
        }
        if (populatedDestinations.has(destinationIndex)) {
          return invalidQueryResult(
            `entry ${resultIndex} duplicates locality ${JSON.stringify(result.localityId)}`,
          );
        }
        if (
          !Number.isSafeInteger(result.travelMinutes) ||
          result.travelMinutes < 0 ||
          result.travelMinutes > COMMUTE_MATRIX_MAX_TRAVEL_MINUTES
        ) {
          return invalidQueryResult(
            `entry ${resultIndex} travelMinutes must be an integer from 0 to ${COMMUTE_MATRIX_MAX_TRAVEL_MINUTES}; received ${JSON.stringify(result.travelMinutes)}`,
          );
        }
        populatedDestinations.add(destinationIndex);
        row[destinationIndex] = result.travelMinutes;
      }

      // The shared matrix contract guarantees local self-reachability even if
      // the high-level transit query omits or reports a nonzero self result.
      row[originIndex] = 0;
      return row;
    },
  });
}
