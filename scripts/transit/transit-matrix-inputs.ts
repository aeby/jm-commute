import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { PROJECT_CONFIG } from '@core/config';
import { parseGtfsTimeToSeconds } from '@core/transit/gtfs';
import { parseLocalityRoutingIndexJson } from '@core/transit/locality-routing/parse-locality-routing-index';
import {
  createRaptorReachabilityQuery,
  type TransitReachabilityQuery,
} from '@core/transit/preprocessing';
import type { LocalityId } from '@core/localities';
import type { TransitTravelTimeSource } from '@core/transit/travel-time-manifest';

import { loadRaptorCompiler } from './load-raptor-compiler';
import { LOCALITY_ROUTING_INDEX_PATH } from './paths';
import { createRaptorTimetableFingerprint } from './timetable-fingerprint';

export interface LoadedTransitMatrixCompilerInputs {
  readonly localityIds: readonly LocalityId[];
  readonly queryReachableLocalities: TransitReachabilityQuery;
  readonly source: TransitTravelTimeSource;
  readonly timetableBuildMilliseconds: number;
  readonly transferBuildMilliseconds: number;
  readonly fingerprintMilliseconds: number;
  readonly totalLoadMilliseconds: number;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readUtf8(path: string, description: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${description} at "${path}".`, {
      cause: error,
    });
  }
}

/**
 * Builds the existing RAPTOR compiler state once and binds the existing
 * high-level locality query. No RAPTOR state escapes into generated runtime
 * data.
 *
 * The current repository does not persist a transfer graph, so the trusted
 * construction bridge reads the already-present local GTFS calendar and
 * transfer files while rebuilding that in-memory graph. It never downloads or
 * rewrites source data.
 */
export async function loadTransitMatrixCompilerInputs(): Promise<LoadedTransitMatrixCompilerInputs> {
  const startedAt = performance.now();
  const [localityRoutingJson, loadedTimetable] = await Promise.all([
    readUtf8(LOCALITY_ROUTING_INDEX_PATH, 'locality routing index'),
    loadRaptorCompiler(),
  ]);
  const localityRoutingIndex = parseLocalityRoutingIndexJson(
    localityRoutingJson,
  );
  const localityIds = localityRoutingIndex.entries.map(
    ({ localityId }) => localityId,
  );

  const fingerprintStartedAt = performance.now();
  const timetableFingerprint = createRaptorTimetableFingerprint(
    loadedTimetable.timetable,
  );
  const localityRoutingIndexSha256 = sha256(localityRoutingJson);
  const fingerprintMilliseconds = performance.now() - fingerprintStartedAt;

  const config = PROJECT_CONFIG.transit;
  const queryReachableLocalities = createRaptorReachabilityQuery({
    timetable: loadedTimetable.timetable,
    localityRoutingIndex,
    windowStartSeconds: parseGtfsTimeToSeconds(
      config.referenceScenario.morningWindow.start,
    ),
    windowEndSeconds: parseGtfsTimeToSeconds(
      config.referenceScenario.morningWindow.end,
    ),
    maxTransfers: config.routing.maxTransfers,
    minTransferTimeSeconds: config.routing.minTransferTimeSeconds,
  });
  const gtfsFeedVersion = loadedTimetable.manifest.sourceFeedVersion;
  if (gtfsFeedVersion === undefined || gtfsFeedVersion.length === 0) {
    throw new Error(
      'Fixed-day routing data does not identify its source GTFS feed version.',
    );
  }
  const source: TransitTravelTimeSource = {
    serviceDate: config.referenceScenario.serviceDate,
    morningWindow: config.referenceScenario.morningWindow,
    gtfsFeedVersion,
    routingDataFingerprint: loadedTimetable.manifest.tripsSha256,
    timetableFingerprint,
    localityRoutingIndexSha256,
    routingPolicy: {
      maxTransfers: config.routing.maxTransfers,
      minTransferTimeSeconds: config.routing.minTransferTimeSeconds,
      virtualTransfersEnabled: loadedTimetable.virtualTransfers.enabled,
    },
  };

  return {
    localityIds,
    queryReachableLocalities,
    source,
    timetableBuildMilliseconds: loadedTimetable.timetableBuildMilliseconds,
    transferBuildMilliseconds: loadedTimetable.transferBuildMilliseconds,
    fingerprintMilliseconds,
    totalLoadMilliseconds: performance.now() - startedAt,
  };
}
