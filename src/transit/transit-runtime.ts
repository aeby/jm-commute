import type { LocalityId, ReachableLocality } from '../localities';
import type { RuntimeLocalityRoutingIndex } from './locality-routing/runtime-types';
import { resolveFastestReachableLocalities } from './locality-routing/resolve-fastest-reachable-localities';
import { runRaptorFastestWindow } from './raptor/routing/run-raptor-fastest-window';
import { UNREACHED_TIME } from './raptor/routing/state';
import type { RaptorTimetable } from './raptor/timetable/types';

const transitRuntimeBrand: unique symbol = Symbol('TransitRuntime');

/** Opaque canonical transit runtime. Its RAPTOR arrays remain module-internal. */
export interface TransitRuntime {
  readonly [transitRuntimeBrand]: true;
}

/**
 * Internal bridge contract for already prepared transit data.
 *
 * @internal
 */
export interface PreparedTransitRuntimeOptions {
  readonly timetable: RaptorTimetable;
  readonly localityRoutingIndex: RuntimeLocalityRoutingIndex;
  readonly windowStartSeconds: number;
  readonly windowEndSeconds: number;
  readonly maxTransfers: number;
  readonly minTransferTimeSeconds: number;
}

interface TransitRuntimeInternals extends PreparedTransitRuntimeOptions {
  readonly localityEntryById: ReadonlyMap<
    LocalityId,
    RuntimeLocalityRoutingIndex['entries'][number]
  >;
}

const internalsByRuntime = new WeakMap<TransitRuntime, TransitRuntimeInternals>();

function requireNonnegativeSafeInteger(
  value: number,
  description: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${description} must be a nonnegative safe integer.`);
  }
}

function validatePreparedOptions(options: PreparedTransitRuntimeOptions): void {
  requireNonnegativeSafeInteger(options.windowStartSeconds, 'Window start');
  requireNonnegativeSafeInteger(options.windowEndSeconds, 'Window end');
  if (
    options.windowEndSeconds <= options.windowStartSeconds ||
    options.windowEndSeconds >= UNREACHED_TIME
  ) {
    throw new RangeError(
      'Transit runtime window must contain increasing supported second values.',
    );
  }
  requireNonnegativeSafeInteger(options.maxTransfers, 'Maximum transfers');
  requireNonnegativeSafeInteger(
    options.minTransferTimeSeconds,
    'Minimum transfer time',
  );
}

function buildLocalityEntryMap(
  options: PreparedTransitRuntimeOptions,
): ReadonlyMap<
  LocalityId,
  RuntimeLocalityRoutingIndex['entries'][number]
> {
  const stopCount = options.timetable.sourceStopIds.length;
  const localityEntryById = new Map<
    LocalityId,
    RuntimeLocalityRoutingIndex['entries'][number]
  >();

  for (const entry of options.localityRoutingIndex.entries) {
    if (
      typeof entry.localityId !== 'string' ||
      entry.localityId.length === 0 ||
      entry.localityId.trim() !== entry.localityId
    ) {
      throw new Error('Transit runtime locality IDs must be nonempty and canonical.');
    }
    if (localityEntryById.has(entry.localityId)) {
      throw new Error(
        `Duplicate transit runtime locality "${entry.localityId}".`,
      );
    }
    if (!(entry.stopIndexes instanceof Uint32Array)) {
      throw new TypeError(
        `Transit runtime locality "${entry.localityId}" must use Uint32 stop indexes.`,
      );
    }
    for (const stopIndex of entry.stopIndexes) {
      if (stopIndex >= stopCount) {
        throw new RangeError(
          `Transit runtime locality "${entry.localityId}" references stop index ${stopIndex}, but the timetable has ${stopCount} stops.`,
        );
      }
    }
    localityEntryById.set(entry.localityId, entry);
  }
  return localityEntryById;
}

/**
 * Internal bridge for prepared data and tests. It is intentionally not
 * re-exported by `src/transit/index.ts`; a future Node runtime-data loader will
 * own construction after the transit publication format is frozen.
 *
 * @internal
 */
export function createTransitRuntimeFromPreparedData(
  options: PreparedTransitRuntimeOptions,
): TransitRuntime {
  validatePreparedOptions(options);
  const localityEntryById = buildLocalityEntryMap(options);
  const runtime = Object.freeze({
    [transitRuntimeBrand]: true as const,
  });
  internalsByRuntime.set(runtime, { ...options, localityEntryById });
  return runtime;
}

function requireInternals(runtime: TransitRuntime): TransitRuntimeInternals {
  const internals = internalsByRuntime.get(runtime);
  if (internals === undefined) {
    throw new TypeError('Invalid transit runtime.');
  }
  return internals;
}

/** Runs the canonical fastest-window transit query and returns locality data. */
export function getReachableLocalitiesByTransit(
  runtime: TransitRuntime,
  originLocalityId: LocalityId,
  maxTravelMinutes: number,
): readonly ReachableLocality[] {
  requireNonnegativeSafeInteger(
    maxTravelMinutes,
    'Maximum transit travel minutes',
  );
  const internals = requireInternals(runtime);
  const origin = internals.localityEntryById.get(originLocalityId);
  if (origin === undefined) {
    throw new Error(`Unknown transit-routing locality: ${originLocalityId}`);
  }
  if (origin.stopIndexes.length === 0) {
    throw new Error(
      `Transit-routing locality "${originLocalityId}" has no active stops.`,
    );
  }

  const maxTravelTimeSeconds = Math.max(1, maxTravelMinutes * 60);
  if (!Number.isSafeInteger(maxTravelTimeSeconds)) {
    throw new RangeError(
      'Maximum transit travel minutes exceeds the supported time range.',
    );
  }
  const result = runRaptorFastestWindow(internals.timetable, {
    originStopIndexes: [...origin.stopIndexes],
    windowStartSeconds: internals.windowStartSeconds,
    windowEndSeconds: internals.windowEndSeconds,
    maxTravelTimeSeconds,
    maxTransfers: internals.maxTransfers,
    minTransferTimeSeconds: internals.minTransferTimeSeconds,
  });

  return resolveFastestReachableLocalities(
    result,
    internals.localityRoutingIndex,
  ).filter(({ travelMinutes }) => travelMinutes <= maxTravelMinutes);
}
