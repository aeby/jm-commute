import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  createCarTravelTimeIndex,
  getCarTravelMinutes,
  getCarTravelTimeIndexDiagnostics,
  getReachableLocalitiesByCar,
  parseCarTravelTimeMatrixManifest,
  type CarTravelTimeIndex,
  type CarTravelTimeMatrixManifest,
} from '@core/car';
import { resolveCarRuntimeDataPaths } from '@core/car/node';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const { manifestPath: MANIFEST_PATH, matrixPath: MATRIX_PATH } =
  resolveCarRuntimeDataPaths(PROJECT_ROOT);

const INITIALIZATION_WARMUP_COUNT = 3;
const INITIALIZATION_SAMPLE_COUNT = 20;
const POINT_LOOKUP_WARMUP_COUNT = 10_000;
const POINT_LOOKUP_BATCH_SIZE = 1_000;
const POINT_LOOKUP_SAMPLE_COUNT = 100;
const REACHABILITY_WARMUP_COUNT = 10;
const REACHABILITY_BATCH_SIZE = 10;
const REACHABILITY_SAMPLE_COUNT = 50;
const REACHABILITY_BENCHMARK_ORIGIN_ID = '8001:zurich';
const REACHABILITY_BENCHMARK_MAXIMUM_MINUTES = 90;
const REACHABILITY_LIMITS = [30, 60, 90, 120] as const;

const REFERENCE_ORIGINS = [
  { localityId: '8001:zurich', label: '8001 Zürich' },
  { localityId: '3011:bern', label: '3011 Bern' },
  { localityId: '8750:glarus', label: '8750 Glarus' },
  { localityId: '3920:zermatt', label: '3920 Zermatt' },
] as const;

const REFERENCE_PAIRS = [
  ['8001 Zürich', '8001:zurich', '3011 Bern', '3011:bern'],
  ['3011 Bern', '3011:bern', '8001 Zürich', '8001:zurich'],
  ['8750 Glarus', '8750:glarus', '8001 Zürich', '8001:zurich'],
  ['8001 Zürich', '8001:zurich', '8750 Glarus', '8750:glarus'],
  ['3920 Zermatt', '3920:zermatt', '3930 Visp', '3930:visp'],
  ['3930 Visp', '3930:visp', '3920 Zermatt', '3920:zermatt'],
] as const;

interface MemorySnapshot {
  readonly rss: number;
  readonly heapUsed: number;
  readonly external: number;
  readonly arrayBuffers: number;
}

interface TimingStatistics {
  readonly minimum: number;
  readonly median: number;
  readonly mean: number;
  readonly p95: number;
  readonly maximum: number;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatBytes(bytes: number): string {
  const absolute = Math.abs(bytes);
  const prefix = bytes < 0 ? '-' : '';
  if (absolute < 1_024) {
    return `${prefix}${formatInteger(absolute)} B`;
  }
  if (absolute < 1_024 * 1_024) {
    return `${prefix}${(absolute / 1_024).toFixed(2)} KiB`;
  }
  return `${prefix}${(absolute / (1_024 * 1_024)).toFixed(2)} MiB`;
}

function formatMilliseconds(milliseconds: number): string {
  return `${milliseconds.toFixed(3)} ms`;
}

function formatMicroseconds(milliseconds: number): string {
  return `${(milliseconds * 1_000).toFixed(3)} µs`;
}

function forceGarbageCollection(): void {
  const garbageCollect = (globalThis as { gc?: () => void }).gc;
  garbageCollect?.();
}

function memorySnapshot(): MemorySnapshot {
  const memory = process.memoryUsage();
  return {
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
}

function printMemoryDelta(before: MemorySnapshot, after: MemorySnapshot): void {
  console.log(`  RSS delta: ${formatBytes(after.rss - before.rss)}`);
  console.log(
    `  Heap-used delta: ${formatBytes(after.heapUsed - before.heapUsed)}`,
  );
  console.log(
    `  External-memory delta: ${formatBytes(after.external - before.external)}`,
  );
  console.log(
    `  ArrayBuffer delta: ${formatBytes(after.arrayBuffers - before.arrayBuffers)}`,
  );
}

function summarizeTimings(samples: readonly number[]): TimingStatistics {
  if (samples.length === 0) {
    throw new Error('At least one timing sample is required.');
  }
  const sorted = samples.toSorted((left, right) => left - right);
  const nearestRank = (fraction: number): number =>
    sorted[Math.max(Math.ceil(sorted.length * fraction) - 1, 0)] as number;
  const middleIndex = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middleIndex - 1] as number) +
          (sorted[middleIndex] as number)) /
        2
      : (sorted[middleIndex] as number);
  return {
    minimum: sorted[0] as number,
    median,
    mean: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    p95: nearestRank(0.95),
    maximum: sorted.at(-1) as number,
  };
}

function printTimingStatistics(
  statistics: TimingStatistics,
  format: (milliseconds: number) => string,
): void {
  console.log(`  minimum: ${format(statistics.minimum)}`);
  console.log(`  median: ${format(statistics.median)}`);
  console.log(`  mean: ${format(statistics.mean)}`);
  console.log(`  p95: ${format(statistics.p95)}`);
  console.log(`  maximum: ${format(statistics.maximum)}`);
}

function assertMatrixSha256(
  manifest: CarTravelTimeMatrixManifest,
  matrixBytes: Uint8Array,
): void {
  if (matrixBytes.byteLength !== manifest.matrixByteLength) {
    throw new Error(
      `Matrix has ${matrixBytes.byteLength} bytes; manifest expects ${manifest.matrixByteLength}.`,
    );
  }
  const actualSha256 = createHash('sha256').update(matrixBytes).digest('hex');
  if (actualSha256 !== manifest.matrixSha256) {
    throw new Error(
      `Matrix SHA-256 ${actualSha256} does not match manifest ${manifest.matrixSha256}.`,
    );
  }
}

function createBenchmarkPairIndexes(
  localityCount: number,
  iterationCount: number,
): Uint32Array {
  const indexes = new Uint32Array(iterationCount * 2);
  let state = 0x9e37_79b9;
  for (let iteration = 0; iteration < iterationCount; iteration += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    indexes[iteration * 2] = state % localityCount;
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    indexes[iteration * 2 + 1] = state % localityCount;
  }
  return indexes;
}

function benchmarkInitialization(
  manifest: CarTravelTimeMatrixManifest,
  matrixBytes: Uint8Array,
): readonly number[] {
  for (
    let warmup = 0;
    warmup < INITIALIZATION_WARMUP_COUNT;
    warmup += 1
  ) {
    createCarTravelTimeIndex(manifest, matrixBytes);
  }

  const samplesMilliseconds: number[] = [];
  for (let sample = 0; sample < INITIALIZATION_SAMPLE_COUNT; sample += 1) {
    forceGarbageCollection();
    const startedAt = performance.now();
    createCarTravelTimeIndex(manifest, matrixBytes);
    samplesMilliseconds.push(performance.now() - startedAt);
  }
  forceGarbageCollection();
  return samplesMilliseconds;
}

function benchmarkPointLookups(
  index: CarTravelTimeIndex,
  localityIds: readonly string[],
): { readonly samplesMilliseconds: readonly number[]; readonly checksum: number } {
  const measuredLookupCount =
    POINT_LOOKUP_BATCH_SIZE * POINT_LOOKUP_SAMPLE_COUNT;
  const pairIndexes = createBenchmarkPairIndexes(
    localityIds.length,
    POINT_LOOKUP_WARMUP_COUNT + measuredLookupCount,
  );
  let checksum = 0;
  for (let iteration = 0; iteration < POINT_LOOKUP_WARMUP_COUNT; iteration += 1) {
    const pairOffset = iteration * 2;
    getCarTravelMinutes(
      index,
      localityIds[pairIndexes[pairOffset] as number] as string,
      localityIds[pairIndexes[pairOffset + 1] as number] as string,
    );
  }

  const samplesMilliseconds: number[] = [];
  let nextIteration = POINT_LOOKUP_WARMUP_COUNT;
  for (let sample = 0; sample < POINT_LOOKUP_SAMPLE_COUNT; sample += 1) {
    const startedAt = performance.now();
    for (let batchOffset = 0; batchOffset < POINT_LOOKUP_BATCH_SIZE; batchOffset += 1) {
      const pairOffset = nextIteration * 2;
      const travelMinutes = getCarTravelMinutes(
        index,
        localityIds[pairIndexes[pairOffset] as number] as string,
        localityIds[pairIndexes[pairOffset + 1] as number] as string,
      );
      checksum = (checksum + (travelMinutes ?? 65_535)) >>> 0;
      nextIteration += 1;
    }
    samplesMilliseconds.push(
      (performance.now() - startedAt) / POINT_LOOKUP_BATCH_SIZE,
    );
  }
  return { samplesMilliseconds, checksum };
}

function benchmarkZurichReachability(
  index: CarTravelTimeIndex,
): {
  readonly samplesMilliseconds: readonly number[];
  readonly resultCount: number;
  readonly checksum: number;
} {
  for (let warmup = 0; warmup < REACHABILITY_WARMUP_COUNT; warmup += 1) {
    getReachableLocalitiesByCar(
      index,
      REACHABILITY_BENCHMARK_ORIGIN_ID,
      REACHABILITY_BENCHMARK_MAXIMUM_MINUTES,
    );
  }

  const samplesMilliseconds: number[] = [];
  let checksum = 0;
  let resultCount = 0;
  for (let sample = 0; sample < REACHABILITY_SAMPLE_COUNT; sample += 1) {
    const startedAt = performance.now();
    for (let batchOffset = 0; batchOffset < REACHABILITY_BATCH_SIZE; batchOffset += 1) {
      const reachable = getReachableLocalitiesByCar(
        index,
        REACHABILITY_BENCHMARK_ORIGIN_ID,
        REACHABILITY_BENCHMARK_MAXIMUM_MINUTES,
      );
      resultCount = reachable.length;
      checksum =
        (checksum +
          reachable.length +
          (reachable.at(-1)?.travelMinutes ?? 0)) >>>
        0;
    }
    samplesMilliseconds.push(
      (performance.now() - startedAt) / REACHABILITY_BATCH_SIZE,
    );
  }
  return { samplesMilliseconds, resultCount, checksum };
}

function printReferenceDiagnostics(index: CarTravelTimeIndex): void {
  console.log('Directional point lookups:');
  for (const [fromLabel, fromId, toLabel, toId] of REFERENCE_PAIRS) {
    const travelMinutes = getCarTravelMinutes(index, fromId, toId);
    console.log(
      `  ${fromLabel} → ${toLabel}: ${travelMinutes === undefined ? 'unreachable' : `${travelMinutes} min`}`,
    );
  }

  console.log('');
  console.log('Reference reachable-locality counts (including the origin):');
  for (const origin of REFERENCE_ORIGINS) {
    const counts = REACHABILITY_LIMITS.map(
      (maximumMinutes) =>
        `${maximumMinutes} min: ${formatInteger(getReachableLocalitiesByCar(index, origin.localityId, maximumMinutes).length)}`,
    );
    console.log(`  ${origin.label}: ${counts.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const commandStartedAt = performance.now();
  const fileReadStartedAt = performance.now();
  const [manifestJson, matrixBytes] = await Promise.all([
    readFile(MANIFEST_PATH, 'utf8'),
    readFile(MATRIX_PATH),
  ]);
  const fileReadMilliseconds = performance.now() - fileReadStartedAt;

  const manifestParseStartedAt = performance.now();
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${MANIFEST_PATH}: ${message}`, {
      cause: error,
    });
  }
  const manifest = parseCarTravelTimeMatrixManifest(
    manifestValue,
    MANIFEST_PATH,
  );
  const manifestParseMilliseconds = performance.now() - manifestParseStartedAt;

  const authenticationStartedAt = performance.now();
  assertMatrixSha256(manifest, matrixBytes);
  const authenticationMilliseconds = performance.now() - authenticationStartedAt;

  forceGarbageCollection();
  forceGarbageCollection();
  const memoryBeforeInitialization = memorySnapshot();
  const index = createCarTravelTimeIndex(manifest, matrixBytes);
  forceGarbageCollection();
  forceGarbageCollection();
  const memoryAfterInitialization = memorySnapshot();
  const initializationSamples = benchmarkInitialization(manifest, matrixBytes);
  const diagnostics = getCarTravelTimeIndexDiagnostics(index);
  const localityIdCharacterCount = manifest.localityIds.reduce(
    (sum, localityId) => sum + localityId.length,
    0,
  );

  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Matrix: ${MATRIX_PATH}`);
  console.log(`Localities: ${formatInteger(manifest.localityCount)}`);
  console.log(`File read: ${formatMilliseconds(fileReadMilliseconds)}`);
  console.log(`Manifest parse: ${formatMilliseconds(manifestParseMilliseconds)}`);
  console.log(
    `Binary SHA-256 authentication: ${formatMilliseconds(authenticationMilliseconds)} (matched ${manifest.matrixSha256})`,
  );
  console.log('');
  console.log('Runtime storage:');
  console.log(
    `  Binary input: ${formatInteger(matrixBytes.byteLength)} bytes (${formatBytes(matrixBytes.byteLength)})`,
  );
  console.log(
    `  Runtime matrix view: ${formatInteger(diagnostics.matrixValuesByteLength)} bytes (${formatBytes(diagnostics.matrixValuesByteLength)})`,
  );
  console.log(
    `  Locality-ID characters: ${formatInteger(localityIdCharacterCount)}`,
  );
  console.log(
    `  Approximate UTF-16 locality-ID payload: ${formatInteger(localityIdCharacterCount * 2)} bytes (${formatBytes(localityIdCharacterCount * 2)}; excludes string/object overhead)`,
  );
  console.log(
    `  Locality-ID map entries: ${formatInteger(diagnostics.localityIndexEntryCount)}`,
  );
  console.log(`  Native little-endian host: ${diagnostics.nativeLittleEndian}`);
  console.log(`  Matrix bytes copied by runtime: ${diagnostics.matrixBytesCopied}`);
  console.log('  One-live-index memory delta (source files already loaded):');
  printMemoryDelta(memoryBeforeInitialization, memoryAfterInitialization);
  console.log('');

  console.log(
    `Runtime initialization benchmark (${INITIALIZATION_SAMPLE_COUNT} samples after ${INITIALIZATION_WARMUP_COUNT} warmups):`,
  );
  printTimingStatistics(
    summarizeTimings(initializationSamples),
    formatMilliseconds,
  );
  console.log('');

  printReferenceDiagnostics(index);
  console.log('');

  const pointLookup = benchmarkPointLookups(
    index,
    manifest.localityIds,
  );
  console.log(
    `Single point-lookup benchmark (${POINT_LOOKUP_SAMPLE_COUNT} samples of ${formatInteger(POINT_LOOKUP_BATCH_SIZE)} calls; per-call timings):`,
  );
  printTimingStatistics(
    summarizeTimings(pointLookup.samplesMilliseconds),
    formatMicroseconds,
  );
  console.log(`  deterministic checksum: ${pointLookup.checksum}`);
  console.log('');

  const reachability = benchmarkZurichReachability(index);
  console.log(
    `Zürich max-90-minute reachability benchmark (${REACHABILITY_SAMPLE_COUNT} samples of ${REACHABILITY_BATCH_SIZE} scans; per-scan timings):`,
  );
  printTimingStatistics(
    summarizeTimings(reachability.samplesMilliseconds),
    formatMicroseconds,
  );
  console.log(`  returned localities per scan: ${formatInteger(reachability.resultCount)}`);
  console.log(`  deterministic checksum: ${reachability.checksum}`);
  console.log('');
  console.log(
    `Total diagnostic command: ${formatMilliseconds(performance.now() - commandStartedAt)}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
