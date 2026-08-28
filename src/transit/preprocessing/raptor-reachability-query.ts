import type { LocalityId } from '@jm/commute';
import type { LocalityRoutingStopIndex } from '../locality-routing/types';
import { resolveFastestReachableLocalities } from '../locality-routing/resolve-fastest-reachable-localities';
import { runRaptorFastestWindow } from '../raptor/routing/run-raptor-fastest-window';
import { UNREACHED_TIME } from '../raptor/routing/state';
import type { RaptorTimetable } from '../raptor/timetable/types';
import type { TransitReachabilityQuery } from './travel-time-matrix-row';

export interface RaptorReachabilityQueryOptions {
  readonly timetable: RaptorTimetable;
  readonly localityRoutingIndex: LocalityRoutingStopIndex;
  readonly windowStartSeconds: number;
  readonly windowEndSeconds: number;
  readonly maxTransfers: number;
  readonly minTransferTimeSeconds: number;
}

function requireNonnegativeSafeInteger(
  value: number,
  description: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${description} must be a nonnegative safe integer.`);
  }
}

function validateOptions(options: RaptorReachabilityQueryOptions): void {
  requireNonnegativeSafeInteger(options.windowStartSeconds, 'Window start');
  requireNonnegativeSafeInteger(options.windowEndSeconds, 'Window end');
  if (
    options.windowEndSeconds <= options.windowStartSeconds ||
    options.windowEndSeconds >= UNREACHED_TIME
  ) {
    throw new RangeError(
      'Transit compiler window must contain increasing supported second values.',
    );
  }
  requireNonnegativeSafeInteger(options.maxTransfers, 'Maximum transfers');
  requireNonnegativeSafeInteger(
    options.minTransferTimeSeconds,
    'Minimum transfer time',
  );
}

/**
 * Binds one prepared RAPTOR timetable to the locality-level query used by the
 * matrix compiler. No opaque runtime handle is needed: the returned closure is
 * preprocessing-only and the production runtime loads only matrix bytes.
 */
export function createRaptorReachabilityQuery(
  options: RaptorReachabilityQueryOptions,
): TransitReachabilityQuery {
  validateOptions(options);
  const stopCount = options.timetable.sourceStopIds.length;
  const localityEntryById = new Map(
    options.localityRoutingIndex.entries.map((entry) => {
      if (
        typeof entry.localityId !== 'string' ||
        entry.localityId.length === 0 ||
        entry.localityId.trim() !== entry.localityId
      ) {
        throw new Error(
          'Transit compiler locality IDs must be nonempty and canonical.',
        );
      }
      if (!(entry.stopIndexes instanceof Uint32Array)) {
        throw new TypeError(
          `Transit compiler locality "${entry.localityId}" must use Uint32 stop indexes.`,
        );
      }
      for (const stopIndex of entry.stopIndexes) {
        if (stopIndex >= stopCount) {
          throw new RangeError(
            `Transit compiler locality "${entry.localityId}" references stop index ${stopIndex}, but the timetable has ${stopCount} stops.`,
          );
        }
      }
      return [entry.localityId, entry] as const;
    }),
  );
  if (localityEntryById.size !== options.localityRoutingIndex.entries.length) {
    throw new Error('Transit compiler locality IDs must be unique.');
  }

  return (originLocalityId: LocalityId, maxTravelMinutes: number) => {
    requireNonnegativeSafeInteger(
      maxTravelMinutes,
      'Maximum transit travel minutes',
    );
    const origin = localityEntryById.get(originLocalityId);
    if (origin === undefined) {
      throw new Error(`Unknown transit-routing locality: ${originLocalityId}`);
    }
    if (origin.stopIndexes.length === 0) {
      return [];
    }

    const maxTravelTimeSeconds = Math.max(1, maxTravelMinutes * 60);
    if (!Number.isSafeInteger(maxTravelTimeSeconds)) {
      throw new RangeError(
        'Maximum transit travel minutes exceeds the supported time range.',
      );
    }
    const result = runRaptorFastestWindow(options.timetable, {
      originStopIndexes: [...origin.stopIndexes],
      windowStartSeconds: options.windowStartSeconds,
      windowEndSeconds: options.windowEndSeconds,
      maxTravelTimeSeconds,
      maxTransfers: options.maxTransfers,
      minTransferTimeSeconds: options.minTransferTimeSeconds,
    });

    return resolveFastestReachableLocalities(
      result,
      options.localityRoutingIndex,
    ).filter(({ travelMinutes }) => travelMinutes <= maxTravelMinutes);
  };
}
