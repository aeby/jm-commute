import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { PROJECT_CONFIG } from '../src/config';
import {
  createLocalityId,
  createLocalityRoutingEntryMap,
  createReachableLocalityMap,
  LocalityResolver,
  parseLocalitiesCsv,
  resolveReachableLocalities,
  type LocalityRoutingIndex,
  type ReachableLocality,
} from '../src/localities';
import { loadLocalityRoutingIndex } from '../src/localities/routing/node';
import {
  runRaptorOneToAll,
  UNREACHED_TIME,
  type RaptorQuery,
  type RaptorResult,
} from '../src/transit/raptor';
import { parseGtfsTimeToSeconds } from '../src/transit/service-profiles';
import {
  DEFAULT_LOCALITIES_FILE_PATH,
  readUtf8Input,
} from './transit-inspection-inputs';
import { loadRaptorInspectionTimetable } from './load-raptor-inspection-timetable';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_LOCALITY_INDEX_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/locality-routing-index.json',
);
const WARM_UP_COUNT = 5;
const MEASURED_COUNT = 50;

interface DurationStatistics {
  readonly minimum: number;
  readonly median: number;
  readonly mean: number;
  readonly p95: number;
  readonly maximum: number;
}

const requireOption = (value: string | undefined, name: string): string => {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required option --${name}.`);
  }
  return value;
};

function parseMaximumTravelMinutes(value: string): number {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error('--max-travel-minutes must be a positive integer.');
  }
  return minutes;
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  const index = Math.max(Math.ceil(sortedValues.length * fraction) - 1, 0);
  return sortedValues[index] ?? 0;
}

function summarizeDurations(values: readonly number[]): DurationStatistics {
  const sorted = values.toSorted((left, right) => left - right);
  return {
    minimum: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: percentile(sorted, 0.95),
    maximum: sorted.at(-1) ?? 0,
  };
}

function formatDurationStatistics(
  label: string,
  statistics: DurationStatistics,
): void {
  console.log(`${label}:`);
  console.log(`  minimum: ${statistics.minimum.toFixed(3)} ms`);
  console.log(`  median: ${statistics.median.toFixed(3)} ms`);
  console.log(`  mean: ${statistics.mean.toFixed(3)} ms`);
  console.log(`  p95: ${statistics.p95.toFixed(3)} ms`);
  console.log(`  maximum: ${statistics.maximum.toFixed(3)} ms`);
}

function countReachableStops(result: RaptorResult): number {
  let count = 0;
  for (const arrival of result.arrivalTimes) {
    if (arrival !== UNREACHED_TIME) {
      count += 1;
    }
  }
  return count;
}

function bucketMinutes(maximumMinutes: number): readonly number[] {
  const buckets: number[] = [];
  for (let minutes = 15; minutes <= maximumMinutes; minutes += 15) {
    buckets.push(minutes);
  }
  if (buckets.at(-1) !== maximumMinutes) {
    buckets.push(maximumMinutes);
  }
  return buckets;
}

function printLocalities(
  title: string,
  reachable: readonly ReachableLocality[],
  index: LocalityRoutingIndex,
): void {
  const entryById = createLocalityRoutingEntryMap(index);
  console.log(title);
  for (const locality of reachable) {
    const entry = entryById.get(locality.localityId);
    if (entry === undefined) {
      throw new Error(
        `Reachable locality "${locality.localityId}" is absent from its source index.`,
      );
    }
    console.log(
      `  ${String(locality.travelMinutes).padStart(3)} min  ${entry.postalCode} ${entry.city}  (${locality.localityId})`,
    );
  }
}

function verifyMonotonicity(
  results: ReadonlyMap<number, readonly ReachableLocality[]>,
): void {
  const limits = [30, 60, 90] as const;
  for (let index = 0; index < limits.length - 1; index += 1) {
    const shorterLimit = limits[index] as number;
    const longerLimit = limits[index + 1] as number;
    const shorter = createReachableLocalityMap(results.get(shorterLimit) ?? []);
    const longer = createReachableLocalityMap(results.get(longerLimit) ?? []);

    for (const [localityId, travelMinutes] of shorter) {
      const longerTravelMinutes = longer.get(localityId);
      if (longerTravelMinutes === undefined) {
        throw new Error(
          `Monotonicity failed: ${localityId} is reachable within ${shorterLimit} minutes but not ${longerLimit}.`,
        );
      }
      if (longerTravelMinutes !== travelMinutes) {
        throw new Error(
          `Stable-arrival check failed for ${localityId}: ${travelMinutes} minutes at ${shorterLimit}, ${longerTravelMinutes} at ${longerLimit}.`,
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'localities-file': { type: 'string' },
      'locality-index-file': { type: 'string' },
      'postal-code': { type: 'string' },
      city: { type: 'string' },
      'max-travel-minutes': { type: 'string' },
      benchmark: { type: 'boolean', default: false },
      'verify-monotonicity': { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  const postalCode = requireOption(values['postal-code'], 'postal-code');
  const city = requireOption(values.city, 'city');
  const maximumTravelMinutes = parseMaximumTravelMinutes(
    requireOption(values['max-travel-minutes'], 'max-travel-minutes'),
  );
  const localitiesFile = resolve(
    values['localities-file'] ?? DEFAULT_LOCALITIES_FILE_PATH,
  );
  const localityIndexPath = resolve(
    values['locality-index-file'] ?? DEFAULT_LOCALITY_INDEX_PATH,
  );
  const [localitiesCsv, localityIndex] = await Promise.all([
    readUtf8Input(localitiesFile, 'locality CSV'),
    loadLocalityRoutingIndex(localityIndexPath),
  ]);
  const locality = new LocalityResolver(
    parseLocalitiesCsv(localitiesCsv),
  ).resolve({ postalCode, city });
  if (locality === undefined) {
    throw new Error(`Unable to resolve locality: ${postalCode} ${city}.`);
  }

  const localityId = createLocalityId(locality.postalCode, locality.city);
  const originEntry = createLocalityRoutingEntryMap(localityIndex).get(
    localityId,
  );
  if (originEntry === undefined) {
    throw new Error(`Locality routing index is missing "${localityId}".`);
  }
  if (originEntry.stopIndexes.length === 0) {
    throw new Error(`Locality "${localityId}" has no active routing stops.`);
  }

  const { timetable } = await loadRaptorInspectionTimetable();
  const departureTimeSeconds = parseGtfsTimeToSeconds(
    PROJECT_CONFIG.transit.referenceScenario.departureTime,
  );
  const routingDefaults = PROJECT_CONFIG.transit.routing;
  const originStopIndexes = [...originEntry.stopIndexes];
  const createQuery = (minutes: number): RaptorQuery => ({
    originStopIndexes,
    departureTimeSeconds,
    maxTravelTimeSeconds: minutes * 60,
    maxTransfers: routingDefaults.maxTransfers,
    minTransferTimeSeconds: routingDefaults.minTransferTimeSeconds,
  });

  const query = createQuery(maximumTravelMinutes);
  const routingStart = performance.now();
  const routingResult = runRaptorOneToAll(timetable, query);
  const routingMilliseconds = performance.now() - routingStart;
  const reductionStart = performance.now();
  const reachable = resolveReachableLocalities(routingResult, localityIndex);
  const reductionMilliseconds = performance.now() - reductionStart;

  console.log(`Origin locality: ${locality.postalCode} ${locality.city}`);
  console.log(`Locality ID: ${localityId}`);
  console.log(`Candidate selection mode: ${originEntry.selectionMode}`);
  console.log(
    `Departure time: ${PROJECT_CONFIG.transit.referenceScenario.departureTime}`,
  );
  console.log(`Maximum commute time: ${maximumTravelMinutes} min`);
  console.log(`Origin routing stops: ${originEntry.stopIndexes.length}`);
  console.log('');
  console.log(`Reachable RAPTOR stops: ${countReachableStops(routingResult)}`);
  console.log(`Reachable localities: ${reachable.length}`);
  for (const minutes of bucketMinutes(maximumTravelMinutes)) {
    console.log(
      `Reachable within ${minutes} min: ${reachable.filter((item) => item.travelMinutes <= minutes).length}`,
    );
  }
  console.log('');
  console.log(`RAPTOR time: ${routingMilliseconds.toFixed(3)} ms`);
  console.log(`Locality reduction time: ${reductionMilliseconds.toFixed(3)} ms`);
  console.log(
    `Total routing + reduction time: ${(routingMilliseconds + reductionMilliseconds).toFixed(3)} ms`,
  );
  console.log('');
  printLocalities(
    'First reachable localities:',
    reachable.slice(0, 30),
    localityIndex,
  );
  console.log('');
  printLocalities(
    'Furthest reachable localities:',
    reachable.slice(-10),
    localityIndex,
  );

  if (values['verify-monotonicity']) {
    const results = new Map<number, readonly ReachableLocality[]>();
    for (const minutes of [30, 60, 90]) {
      const result = runRaptorOneToAll(timetable, createQuery(minutes));
      results.set(
        minutes,
        resolveReachableLocalities(result, localityIndex),
      );
    }
    verifyMonotonicity(results);
    console.log('');
    console.log('Monotonicity verification: PASS');
    for (const minutes of [30, 60, 90]) {
      console.log(
        `  ${minutes} min: ${results.get(minutes)?.length ?? 0} reachable localities`,
      );
    }
    console.log('  Travel times stable across larger limits: yes');
  }

  if (values.benchmark) {
    for (let index = 0; index < WARM_UP_COUNT; index += 1) {
      resolveReachableLocalities(
        runRaptorOneToAll(timetable, query),
        localityIndex,
      );
    }

    const routingDurations: number[] = [];
    const reductionDurations: number[] = [];
    const totalDurations: number[] = [];
    for (let index = 0; index < MEASURED_COUNT; index += 1) {
      const totalStart = performance.now();
      const iterationRoutingStart = performance.now();
      const iterationResult = runRaptorOneToAll(timetable, query);
      routingDurations.push(performance.now() - iterationRoutingStart);
      const iterationReductionStart = performance.now();
      resolveReachableLocalities(iterationResult, localityIndex);
      reductionDurations.push(performance.now() - iterationReductionStart);
      totalDurations.push(performance.now() - totalStart);
    }

    console.log('');
    console.log(
      `Benchmark (${WARM_UP_COUNT} warm-up, ${MEASURED_COUNT} measured runs):`,
    );
    formatDurationStatistics(
      'RAPTOR',
      summarizeDurations(routingDurations),
    );
    formatDurationStatistics(
      'Locality reduction',
      summarizeDurations(reductionDurations),
    );
    formatDurationStatistics('Total', summarizeDurations(totalDurations));
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
