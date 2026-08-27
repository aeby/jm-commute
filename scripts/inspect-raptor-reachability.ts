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
  runRaptorOneToAll,
  UNREACHED_TIME,
  type RaptorQuery,
  type RaptorResult,
  type RaptorRoutingDiagnostics,
} from '../src/transit/raptor';
import {
  buildRaptorTimetable,
  buildSourceStopIndex,
  readRoutingTripsNdjson,
} from '../src/transit/raptor/timetable';
import { parseGtfsTimeToSeconds } from '../src/transit/service-profiles';
import {
  DEFAULT_LOCALITIES_FILE_PATH,
  loadTransitCandidateInputs,
  readUtf8Input,
} from './transit-inspection-inputs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const ROUTING_TRIPS_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/fixed-day-routing/trips.ndjson',
);
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

const percentile = (sortedValues: readonly number[], fraction: number): number => {
  const index = Math.ceil(sortedValues.length * fraction) - 1;
  return sortedValues[Math.max(index, 0)] ?? 0;
};

const benchmarkRouter = (
  query: RaptorQuery,
  run: (query: RaptorQuery) => RaptorResult,
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
  result: RaptorResult,
  maximumTravelSeconds: number,
): number => {
  let count = 0;
  for (const arrivalTime of result.arrivalTimes) {
    if (
      arrivalTime !== UNREACHED_TIME &&
      arrivalTime - result.departureTimeSeconds <= maximumTravelSeconds
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

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'localities-file': { type: 'string' },
      'postal-code': { type: 'string' },
      city: { type: 'string' },
      'max-travel-minutes': { type: 'string' },
      benchmark: { type: 'boolean', default: false },
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

  const timetableBuildStart = performance.now();
  const timetable = await buildRaptorTimetable(
    readRoutingTripsNdjson(ROUTING_TRIPS_PATH),
  );
  const timetableBuildMilliseconds = performance.now() - timetableBuildStart;
  const stopIndexBySourceId = buildSourceStopIndex(timetable.sourceStopIds);
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

  const departureTimeSeconds = parseGtfsTimeToSeconds(
    PROJECT_CONFIG.transit.referenceScenario.departureTime,
  );
  const routingDefaults = PROJECT_CONFIG.transit.routing;
  const query: RaptorQuery = {
    originStopIndexes,
    departureTimeSeconds,
    maxTravelTimeSeconds: maximumTravelMinutes * 60,
    maxTransfers: routingDefaults.maxTransfers,
    minTransferTimeSeconds: routingDefaults.minTransferTimeSeconds,
  };
  let diagnostics: RaptorRoutingDiagnostics | undefined;
  const result = runRaptorOneToAll(timetable, query, (value) => {
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
    `Departure time: ${PROJECT_CONFIG.transit.referenceScenario.departureTime}`,
  );
  console.log(`Maximum travel time: ${maximumTravelMinutes} min`);
  console.log(`Maximum transfers: ${query.maxTransfers}`);
  console.log(`Minimum transfer time: ${query.minTransferTimeSeconds} s`);
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
  console.log(`Rounds executed: ${diagnostics.roundsExecuted}`);
  console.log(`Patterns scanned: ${diagnostics.patternsScanned}`);
  console.log(
    `Pattern scans per round: ${diagnostics.patternScansPerRound.join(', ')}`,
  );
  console.log(`Stops improved: ${diagnostics.stopsImproved}`);
  console.log(
    `Timetable construction time: ${(timetableBuildMilliseconds / 1000).toFixed(3)} s`,
  );

  if (values.benchmark) {
    const benchmark = benchmarkRouter(query, (benchmarkQuery) =>
      runRaptorOneToAll(timetable, benchmarkQuery),
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
