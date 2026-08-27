import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { PROJECT_CONFIG } from '../src/config';
import {
  LocalityResolver,
  parseLocalitiesCsv,
} from '../src/localities';
import { selectTransitPlaceCandidates } from '../src/transit/candidates';
import {
  runRaptorFastestWindow,
  UNREACHED_TIME,
  type FastestWindowQuery,
  type FastestWindowResult,
  type FastestWindowRoutingDiagnostics,
} from '../src/transit/raptor';
import { parseGtfsTimeToSeconds } from '../src/transit/service-profiles';
import {
  DEFAULT_LOCALITIES_FILE_PATH,
  loadTransitCandidateInputs,
  readUtf8Input,
} from './transit-inspection-inputs';
import { loadRaptorInspectionTimetable } from './load-raptor-inspection-timetable';

const WARM_UP_QUERY_COUNT = 5;
const BENCHMARK_QUERY_COUNT = 50;

const requireOption = (value: string | undefined, name: string): string => {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required option --${name}.`);
  }
  return value;
};

const parseMaximumTravelMinutes = (value: string): number => {
  const minutes = Number(value);
  if (
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    !Number.isSafeInteger(minutes * 60)
  ) {
    throw new Error(
      '--max-travel-minutes must be positive and resolve to a whole number of seconds.',
    );
  }
  return minutes;
};

const formatMilliseconds = (value: number): string => `${value.toFixed(3)} ms`;
const formatInteger = (value: number): string =>
  new Intl.NumberFormat('en-US').format(value);
const formatBytes = (value: number): string =>
  `${formatInteger(value)} bytes (${(value / 1024 / 1024).toFixed(2)} MiB)`;

const percentile = (sortedValues: readonly number[], fraction: number): number => {
  const index = Math.ceil(sortedValues.length * fraction) - 1;
  return sortedValues[Math.max(index, 0)] ?? 0;
};

const benchmarkRouter = (
  query: FastestWindowQuery,
  run: (query: FastestWindowQuery) => FastestWindowResult,
): {
  readonly minimum: number;
  readonly median: number;
  readonly mean: number;
  readonly p95: number;
  readonly maximum: number;
} => {
  for (let index = 0; index < WARM_UP_QUERY_COUNT; index += 1) {
    run(query);
  }

  const durations: number[] = [];
  for (let index = 0; index < BENCHMARK_QUERY_COUNT; index += 1) {
    const start = performance.now();
    run(query);
    durations.push(performance.now() - start);
  }
  const sortedDurations = durations.toSorted((left, right) => left - right);
  const mean = durations.reduce((total, duration) => total + duration, 0) /
    durations.length;

  return {
    minimum: sortedDurations[0] ?? 0,
    median: percentile(sortedDurations, 0.5),
    mean,
    p95: percentile(sortedDurations, 0.95),
    maximum: sortedDurations.at(-1) ?? 0,
  };
};

const countReachableWithin = (
  result: FastestWindowResult,
  maximumTravelSeconds: number,
): number => {
  let count = 0;
  for (const durationSeconds of result.durationSeconds) {
    if (
      durationSeconds !== UNREACHED_TIME &&
      durationSeconds <= maximumTravelSeconds
    ) {
      count += 1;
    }
  }
  return count;
};

const bucketMinutes = (maximumMinutes: number): readonly number[] => {
  const buckets: number[] = [];
  for (let minutes = 15; minutes <= maximumMinutes; minutes += 15) {
    buckets.push(minutes);
  }
  if (buckets.at(-1) !== maximumMinutes) {
    buckets.push(maximumMinutes);
  }
  return buckets;
};

const transferGraphFingerprint = (
  transfersByStop: readonly Uint32Array[],
): string => {
  const hash = createHash('sha256');
  transfersByStop.forEach((edges) => {
    hash.update(`${edges.length}:`);
    hash.update(Buffer.from(edges.buffer, edges.byteOffset, edges.byteLength));
  });
  return hash.digest('hex');
};

const transferDegreeStatistics = (
  transfersByStop: readonly Uint32Array[],
): {
  readonly stopsWithTransfers: number;
  readonly medianOutgoingTransfers: number;
  readonly maximumOutgoingTransfers: number;
  readonly typedArrayBytes: number;
} => {
  const degrees = transfersByStop
    .map((edges) => edges.length / 2)
    .filter((degree) => degree > 0)
    .toSorted((left, right) => left - right);
  const middle = Math.floor(degrees.length / 2);
  const median =
    degrees.length === 0
      ? 0
      : degrees.length % 2 === 1
        ? (degrees[middle] ?? 0)
        : ((degrees[middle - 1] ?? 0) + (degrees[middle] ?? 0)) / 2;
  return {
    stopsWithTransfers: degrees.length,
    medianOutgoingTransfers: median,
    maximumOutgoingTransfers: degrees.at(-1) ?? 0,
    typedArrayBytes: transfersByStop.reduce(
      (total, edges) => total + edges.byteLength,
      0,
    ),
  };
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'localities-file': { type: 'string' },
      'postal-code': { type: 'string' },
      city: { type: 'string' },
      'max-travel-minutes': { type: 'string' },
      benchmark: { type: 'boolean', default: false },
      'virtual-transfers': { type: 'boolean' },
    },
    allowPositionals: false,
    strict: true,
  });
  const localitiesFile = resolve(
    values['localities-file'] ?? DEFAULT_LOCALITIES_FILE_PATH,
  );
  const postalCode = requireOption(values['postal-code'], 'postal-code');
  const city = requireOption(values.city, 'city');
  const maximumTravelMinutes = parseMaximumTravelMinutes(
    requireOption(values['max-travel-minutes'], 'max-travel-minutes'),
  );

  const [localitiesCsv, candidateInputs] = await Promise.all([
    readUtf8Input(localitiesFile, 'locality CSV'),
    loadTransitCandidateInputs(),
  ]);
  const locality = new LocalityResolver(
    parseLocalitiesCsv(localitiesCsv),
  ).resolve({ postalCode, city });
  if (locality === undefined) {
    throw new Error(`Unable to resolve locality: ${postalCode} ${city}.`);
  }

  const selection = selectTransitPlaceCandidates(
    locality,
    candidateInputs.places,
    candidateInputs.profileDataset,
  );
  if (selection.candidates.length === 0) {
    throw new Error(
      `No transit-place candidates found for ${locality.postalCode} ${locality.city}.`,
    );
  }

  const {
    timetable,
    stopIndexBySourceId,
    transferGraph,
    virtualTransfers,
    timetableBuildMilliseconds,
    transferBuildMilliseconds,
    transferMemoryBefore,
    transferMemoryAfter,
  } = await loadRaptorInspectionTimetable({
    virtualTransfersEnabled: values['virtual-transfers'],
  });
  const transferDegrees = transferDegreeStatistics(
    transferGraph.transfersByStop,
  );
  const accessTransferDegrees = transferDegreeStatistics(
    transferGraph.accessTransfersByStop,
  );
  const originStopIndexSet = new Set<number>();
  let absentRoutingStopCount = 0;
  for (const { place } of selection.candidates) {
    for (const sourceStopId of place.stopIds) {
      const stopIndex = stopIndexBySourceId.get(sourceStopId);
      if (stopIndex === undefined) {
        absentRoutingStopCount += 1;
      } else {
        originStopIndexSet.add(stopIndex);
      }
    }
  }
  const originStopIndexes = [...originStopIndexSet].toSorted(
    (left, right) => left - right,
  );
  if (originStopIndexes.length === 0) {
    throw new Error(
      'None of the selected transit-place stop IDs exists in the active RAPTOR timetable.',
    );
  }

  const windowStartSeconds = parseGtfsTimeToSeconds(
    PROJECT_CONFIG.transit.referenceScenario.morningWindow.start,
  );
  const windowEndSeconds = parseGtfsTimeToSeconds(
    PROJECT_CONFIG.transit.referenceScenario.morningWindow.end,
  );
  const routingDefaults = PROJECT_CONFIG.transit.routing;
  const query: FastestWindowQuery = {
    originStopIndexes,
    windowStartSeconds,
    windowEndSeconds,
    maxTravelTimeSeconds: maximumTravelMinutes * 60,
    maxTransfers: routingDefaults.maxTransfers,
    minTransferTimeSeconds: routingDefaults.minTransferTimeSeconds,
  };
  let diagnostics: FastestWindowRoutingDiagnostics | undefined;
  const result = runRaptorFastestWindow(timetable, query, (value) => {
    diagnostics = value;
  });
  if (diagnostics === undefined) {
    throw new Error('RAPTOR routing did not report diagnostics.');
  }

  console.log(`Locality: ${locality.postalCode} ${locality.city}`);
  console.log(`Candidate selection mode: ${selection.mode}`);
  console.log(`Candidate transit places: ${selection.candidates.length}`);
  selection.candidates.forEach(({ place, distanceMeters }, index) => {
    console.log(
      `  ${index + 1}. ${place.name} (${distanceMeters.toFixed(1)} m, ${place.stopIds.length} routing stop IDs)`,
    );
  });
  console.log(`Origin routing stop count: ${originStopIndexes.length}`);
  console.log(
    `Selected stop IDs absent from active timetable: ${absentRoutingStopCount}`,
  );
  console.log('');
  console.log(
    `Morning departure window: ${PROJECT_CONFIG.transit.referenceScenario.morningWindow.start}–${PROJECT_CONFIG.transit.referenceScenario.morningWindow.end}`,
  );
  console.log(`Maximum travel time: ${maximumTravelMinutes} min`);
  console.log(`Maximum transfers: ${query.maxTransfers}`);
  console.log(`Minimum transfer time: ${query.minTransferTimeSeconds} s`);
  console.log('');
  console.log(`GTFS transfer rows: ${formatInteger(transferGraph.statistics.gtfsRows)}`);
  console.log(
    `Supported generic GTFS edges: ${formatInteger(transferGraph.statistics.gtfsSupportedEdges)}`,
  );
  console.log(
    `Forbidden GTFS pairs: ${formatInteger(transferGraph.statistics.gtfsForbiddenPairs)}`,
  );
  console.log(
    `Timed transfers approximated: ${formatInteger(transferGraph.statistics.timedTransfersApproximated)}`,
  );
  console.log(
    `Duplicate explicit edges merged: ${formatInteger(transferGraph.statistics.duplicateExplicitEdgesMerged)}`,
  );
  console.log(
    `Inactive-service rows skipped: ${formatInteger(transferGraph.statistics.inactiveServiceRowsSkipped)}`,
  );
  console.log(
    `Inactive-stop rows skipped: ${formatInteger(transferGraph.statistics.inactiveStopRowsSkipped)}`,
  );
  console.log(
    `Sibling transfers generated: ${formatInteger(transferGraph.statistics.siblingEdgesGenerated)}`,
  );
  console.log(`Virtual transfers enabled: ${virtualTransfers.enabled ? 'yes' : 'no'}`);
  console.log(
    `Virtual transfers generated: ${formatInteger(transferGraph.statistics.virtualEdgesGenerated)}`,
  );
  console.log(
    `Unsupported trip-specific rows: ${formatInteger(transferGraph.statistics.unsupportedTripSpecificRows)}`,
  );
  console.log(
    `Unsupported route-specific rows: ${formatInteger(transferGraph.statistics.unsupportedRouteSpecificRows)}`,
  );
  console.log(
    `Unsupported in-seat rows: ${formatInteger(transferGraph.statistics.unsupportedInSeatRows)}`,
  );
  console.log(
    `Unsupported other constrained rows: ${formatInteger(transferGraph.statistics.unsupportedOtherConstrainedRows)}`,
  );
  console.log(
    `Final active transfer edges: ${formatInteger(transferGraph.statistics.finalTransferEdges)}`,
  );
  console.log(
    `Initial-access eligible edges: ${formatInteger(transferGraph.statistics.finalAccessTransferEdges)}`,
  );
  console.log(
    `Stops with transfers: ${formatInteger(transferDegrees.stopsWithTransfers)}`,
  );
  console.log(
    `Median outgoing transfers: ${transferDegrees.medianOutgoingTransfers}`,
  );
  console.log(
    `Maximum outgoing transfers: ${formatInteger(transferDegrees.maximumOutgoingTransfers)}`,
  );
  console.log(
    `Transfer typed-array bytes: ${formatBytes(transferDegrees.typedArrayBytes)}`,
  );
  console.log(
    `Transfer graph fingerprint: ${transferGraphFingerprint(transferGraph.transfersByStop)}`,
  );
  console.log(
    `Initial-access graph fingerprint: ${transferGraphFingerprint(transferGraph.accessTransfersByStop)}`,
  );
  console.log(
    `Initial-access typed-array bytes: ${formatBytes(accessTransferDegrees.typedArrayBytes)}`,
  );
  console.log('');
  console.log(
    `Reachable stops: ${countReachableWithin(result, query.maxTravelTimeSeconds)}`,
  );
  bucketMinutes(maximumTravelMinutes).forEach((minutes) => {
    console.log(
      `Reachable within ${minutes} min: ${countReachableWithin(result, minutes * 60)}`,
    );
  });
  console.log('');
  console.log(`Meaningful departure slots: ${diagnostics.departureSlotCount}`);
  console.log(`Range runs: ${diagnostics.rangeRuns}`);
  console.log(`Patterns scanned: ${diagnostics.patternsScanned}`);
  console.log(
    `Runs without duration improvements: ${diagnostics.runsWithoutDurationImprovements}`,
  );
  console.log(`Cross-run prunes: ${diagnostics.crossRunPrunes}`);
  console.log(`Original seed stops: ${diagnostics.originalSeedStops}`);
  console.log(
    `Maximum additional initial-access stops: ${diagnostics.maximumAdditionalInitialAccessStops}`,
  );
  console.log(
    `Initial-access edges examined: ${diagnostics.initialAccessEdgesExamined}`,
  );
  console.log(
    `Timetable construction time: ${(timetableBuildMilliseconds / 1000).toFixed(3)} s`,
  );
  console.log(
    `Transfer graph build time: ${(transferBuildMilliseconds / 1000).toFixed(3)} s`,
  );
  console.log(
    `Transfer-build heap delta: ${formatBytes(transferMemoryAfter.heapUsed - transferMemoryBefore.heapUsed)}`,
  );
  console.log(
    `Transfer-build ArrayBuffer delta: ${formatBytes(transferMemoryAfter.arrayBuffers - transferMemoryBefore.arrayBuffers)}`,
  );
  console.log(
    `Transfer-build RSS delta: ${formatBytes(transferMemoryAfter.rss - transferMemoryBefore.rss)}`,
  );

  if (values.benchmark) {
    const benchmark = benchmarkRouter(query, (benchmarkQuery) =>
      runRaptorFastestWindow(timetable, benchmarkQuery),
    );
    console.log('');
    console.log(
      `Routing benchmark (${WARM_UP_QUERY_COUNT} warm-up, ${BENCHMARK_QUERY_COUNT} measured queries):`,
    );
    console.log(`  minimum: ${formatMilliseconds(benchmark.minimum)}`);
    console.log(`  median: ${formatMilliseconds(benchmark.median)}`);
    console.log(`  mean: ${formatMilliseconds(benchmark.mean)}`);
    console.log(`  p95: ${formatMilliseconds(benchmark.p95)}`);
    console.log(`  maximum: ${formatMilliseconds(benchmark.maximum)}`);
  }

}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
