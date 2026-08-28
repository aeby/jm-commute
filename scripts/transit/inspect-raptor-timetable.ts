import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { PROJECT_CONFIG } from '@core/config';
import { validateFixedDayRoutingManifestScenario } from '@core/transit/routing-data';
import { loadFixedDayRoutingDataset } from '@core/transit/routing-data/node';
import { buildRaptorTimetable } from '@core/transit/raptor/timetable/build-raptor-timetable';
import type {
  RaptorTimetable,
  RaptorTimetableBuildStage,
  RaptorTimetableBuildStatistics,
} from '@core/transit/raptor/timetable/types';
import { FIXED_DAY_ROUTING_DIRECTORY } from './paths';

interface MemorySnapshot {
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly arrayBuffers: number;
  readonly rss: number;
}

interface NamedMemorySnapshot extends MemorySnapshot {
  readonly name: string;
}

const memorySnapshot = (): MemorySnapshot => {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    arrayBuffers: usage.arrayBuffers,
    rss: usage.rss,
  };
};

const maximumMemory = (
  left: MemorySnapshot,
  right: MemorySnapshot,
): MemorySnapshot => ({
  heapUsed: Math.max(left.heapUsed, right.heapUsed),
  heapTotal: Math.max(left.heapTotal, right.heapTotal),
  arrayBuffers: Math.max(left.arrayBuffers, right.arrayBuffers),
  rss: Math.max(left.rss, right.rss),
});

const forceGarbageCollection = (): void => {
  const runtime = globalThis as typeof globalThis & { gc?: () => void };
  // V8 can defer releasing external ArrayBuffer backing stores until a
  // subsequent collection even after their JS wrappers become unreachable.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    runtime.gc?.();
  }
};

const formatInteger = (value: number): string =>
  new Intl.NumberFormat('en-US').format(value);

const formatBytes = (bytes: number): string =>
  `${formatInteger(bytes)} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB)`;

const formatMemory = (snapshot: MemorySnapshot): string =>
  `heapUsed=${formatBytes(snapshot.heapUsed)}, ` +
  `heapTotal=${formatBytes(snapshot.heapTotal)}, ` +
  `arrayBuffers=${formatBytes(snapshot.arrayBuffers)}, ` +
  `rss=${formatBytes(snapshot.rss)}`;

const stageNames: Readonly<Record<RaptorTimetableBuildStage, string>> = {
  AFTER_NDJSON_INGESTION_AND_GROUPING: 'after NDJSON ingestion/grouping',
  AFTER_ROUTE_PATTERN_CONSTRUCTION: 'after route-pattern construction',
  AFTER_FINAL_TYPED_ARRAYS: 'after final typed arrays are built',
  AFTER_TEMPORARY_BUILDERS_RELEASED:
    'after temporary builder structures are released',
};

const uniqueByteLength = (
  arrays: readonly (Uint8Array | Uint32Array)[],
): number => {
  const buffers = new Set<ArrayBufferLike>();
  let bytes = 0;
  arrays.forEach((array) => {
    if (!buffers.has(array.buffer)) {
      buffers.add(array.buffer);
      bytes += array.byteLength;
    }
  });
  return bytes;
};

const typedArrayStorage = (timetable: RaptorTimetable) => {
  const stopTimeBytes = uniqueByteLength(
    timetable.patterns.map((pattern) => pattern.stopTimes),
  );
  const stopSequenceBytes = uniqueByteLength(
    timetable.patterns.map((pattern) => pattern.stops),
  );
  const pickupDropOffBytes = uniqueByteLength(
    timetable.patterns.map((pattern) => pattern.pickupDropOffTypes),
  );
  const adjacencyBytes = uniqueByteLength(
    timetable.patternOccurrencesByStop,
  );
  return {
    stopTimeBytes,
    stopSequenceBytes,
    pickupDropOffBytes,
    adjacencyBytes,
    totalBytes:
      stopTimeBytes +
      stopSequenceBytes +
      pickupDropOffBytes +
      adjacencyBytes,
  };
};

const timetableFingerprint = (timetable: RaptorTimetable): string => {
  const hash = createHash('sha256');
  const updateString = (value: string): void => {
    hash.update(`${Buffer.byteLength(value)}:`);
    hash.update(value);
  };
  const updateArray = (array: Uint8Array | Uint32Array): void => {
    hash.update(`${array.constructor.name}:${array.length}:`);
    hash.update(
      Buffer.from(array.buffer, array.byteOffset, array.byteLength),
    );
  };

  timetable.sourceStopIds.forEach(updateString);
  timetable.patterns.forEach((pattern) => {
    hash.update(`trips:${pattern.tripCount}:`);
    updateArray(pattern.stops);
    updateArray(pattern.stopTimes);
    updateArray(pattern.pickupDropOffTypes);
  });
  timetable.patternOccurrencesByStop.forEach(updateArray);
  return hash.digest('hex');
};

async function main(): Promise<void> {
  const routingDataset = await loadFixedDayRoutingDataset(
    FIXED_DAY_ROUTING_DIRECTORY,
  );
  const { manifest } = routingDataset;
  const reference = PROJECT_CONFIG.transit.referenceScenario;
  validateFixedDayRoutingManifestScenario(manifest, {
    serviceDate: reference.serviceDate,
    routingWindowStart: reference.morningWindow.start,
    routingWindowEnd: reference.morningWindow.end,
  });
  const checkpoints: NamedMemorySnapshot[] = [];
  forceGarbageCollection();
  let peak = memorySnapshot();
  checkpoints.push({ name: 'before processing', ...peak });

  const sampler = setInterval(() => {
    peak = maximumMemory(peak, memorySnapshot());
  }, 100);
  sampler.unref();

  let statistics: RaptorTimetableBuildStatistics | undefined;
  const start = performance.now();
  let timetable: RaptorTimetable;
  try {
    timetable = await buildRaptorTimetable(
      routingDataset.trips,
      {
        onStage: (stage) => {
          forceGarbageCollection();
          const snapshot = memorySnapshot();
          peak = maximumMemory(peak, snapshot);
          checkpoints.push({ name: stageNames[stage], ...snapshot });
        },
        onStatistics: (result) => {
          statistics = result;
        },
      },
    );
  } finally {
    clearInterval(sampler);
  }
  const buildMilliseconds = performance.now() - start;
  peak = maximumMemory(peak, memorySnapshot());

  if (statistics === undefined) {
    throw new Error('RAPTOR timetable build did not report statistics');
  }
  const stats: RaptorTimetableBuildStatistics = statistics;
  const storage = typedArrayStorage(timetable);

  console.log(`Feed version: ${manifest.sourceFeedVersion ?? 'not supplied'}`);
  console.log(`Input retained trips: ${formatInteger(stats.inputRetainedTrips)}`);
  console.log(
    `Scheduled concrete trips: ${formatInteger(stats.scheduledConcreteTrips)}`,
  );
  console.log(`Frequency templates: ${formatInteger(stats.frequencyTemplates)}`);
  console.log(
    `Generated frequency trips: ${formatInteger(stats.generatedFrequencyTrips)}`,
  );
  console.log(
    `Frequency instances excluded before routing window: ${formatInteger(stats.frequencyInstancesExcludedBeforeRoutingWindow)}`,
  );
  console.log(`Final concrete trips: ${formatInteger(stats.finalConcreteTrips)}`);
  console.log('');
  console.log(`Active numeric stops: ${formatInteger(stats.activeNumericStops)}`);
  console.log(`Base route patterns: ${formatInteger(stats.baseRoutePatterns)}`);
  console.log(
    `Final non-overtaking route patterns: ${formatInteger(stats.finalNonOvertakingRoutePatterns)}`,
  );
  console.log(
    `Base patterns requiring overtaking splits: ${formatInteger(stats.basePatternsRequiringOvertakingSplits)}`,
  );
  console.log(
    `Additional patterns created by splitting: ${formatInteger(stats.additionalPatternsCreatedBySplitting)}`,
  );
  console.log(
    `Maximum split count for one base pattern: ${formatInteger(stats.maximumSplitCountForOneBasePattern)}`,
  );
  console.log(
    `Concrete trips in final patterns: ${formatInteger(stats.finalConcreteTrips)}`,
  );
  console.log(`Stop-time entries: ${formatInteger(stats.stopTimeEntries)}`);
  console.log(
    `Trips per pattern (min / median / max): ${formatInteger(stats.minimumTripsPerPattern)} / ${stats.medianTripsPerPattern.toFixed(1)} / ${formatInteger(stats.maximumTripsPerPattern)}`,
  );
  console.log('');
  console.log(`Stop-time typed-array bytes: ${formatBytes(storage.stopTimeBytes)}`);
  console.log(
    `Stop-sequence typed-array bytes: ${formatBytes(storage.stopSequenceBytes)}`,
  );
  console.log(
    `Pickup/drop-off typed-array bytes: ${formatBytes(storage.pickupDropOffBytes)}`,
  );
  console.log(`Adjacency typed-array bytes: ${formatBytes(storage.adjacencyBytes)}`);
  console.log(`Total typed-array bytes: ${formatBytes(storage.totalBytes)}`);
  console.log('');
  console.log('Memory checkpoints:');
  checkpoints.forEach((checkpoint) => {
    console.log(`  ${checkpoint.name}: ${formatMemory(checkpoint)}`);
  });
  console.log(`  sampled peak: ${formatMemory(peak)}`);
  console.log(`Build time: ${(buildMilliseconds / 1000).toFixed(3)} s`);
  console.log(`Timetable SHA-256: ${timetableFingerprint(timetable)}`);

  if (stats.overtakingSplitExamples.length > 0) {
    console.log('');
    console.log('Overtaking split examples (up to 10):');
    stats.overtakingSplitExamples.forEach((example) => {
      console.log(
        `  ${example.sourceRouteId}: ${example.stopCount} stops, ${example.tripCount} trips, ${example.resultingPatternCount} patterns`,
      );
    });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
