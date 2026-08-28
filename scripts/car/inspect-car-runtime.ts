import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  createCarTravelTimeIndex,
  getCarTravelMinutes,
  getReachableLocalitiesByCar,
  type CarTravelTimeIndex,
} from '@core/car';
import { resolveCarRuntimeDataPaths } from '@core/car/node';
import { getCarTravelTimeIndexDiagnostics } from '@core/car/travel-time-index';
import { UNAVAILABLE_TRAVEL_TIME } from '@core/travel-time-matrix';

import {
  authenticateRuntimeCarData,
  authenticateSourceCarData,
} from './runtime-car-data';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const RUNTIME_PATHS = resolveCarRuntimeDataPaths(PROJECT_ROOT);
const SOURCE_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/car/travel-time-matrix',
);
const SOURCE_MANIFEST_PATH = resolve(SOURCE_DIRECTORY, 'manifest.json');
const SOURCE_MATRIX_PATH = resolve(SOURCE_DIRECTORY, 'travel-times.bin');

const REFERENCE_ORIGINS = [
  { localityId: '8001:zurich', label: '8001 Zürich' },
  { localityId: '3011:bern', label: '3011 Bern' },
  { localityId: '8750:glarus', label: '8750 Glarus' },
  { localityId: '3920:zermatt', label: '3920 Zermatt' },
] as const;
const REACHABILITY_LIMITS = [30, 60, 90, 120, 180, 240] as const;
const REFERENCE_PAIRS = [
  ['8001 Zürich', '8001:zurich', '3011 Bern', '3011:bern'],
  ['3011 Bern', '3011:bern', '8001 Zürich', '8001:zurich'],
  ['8750 Glarus', '8750:glarus', '8001 Zürich', '8001:zurich'],
  ['8001 Zürich', '8001:zurich', '8750 Glarus', '8750:glarus'],
  ['3920 Zermatt', '3920:zermatt', '3930 Visp', '3930:visp'],
  ['3930 Visp', '3930:visp', '3920 Zermatt', '3920:zermatt'],
] as const;

interface TimingStatistics {
  readonly minimum: number;
  readonly median: number;
  readonly mean: number;
  readonly p95: number;
  readonly maximum: number;
}

interface MatrixExample {
  readonly fromLocalityId: string;
  readonly toLocalityId: string;
  readonly sourceMinutes: number;
  readonly runtimeMinutes: number | undefined;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatBytes(bytes: number): string {
  return `${formatInteger(bytes)} bytes (${(bytes / (1024 * 1024)).toFixed(2)} MiB)`;
}

function summarize(samples: readonly number[]): TimingStatistics {
  const sorted = samples.toSorted((left, right) => left - right);
  const atRank = (fraction: number): number =>
    sorted[Math.max(Math.ceil(sorted.length * fraction) - 1, 0)] as number;
  const midpoint = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[midpoint - 1] as number) + (sorted[midpoint] as number)) / 2
      : (sorted[midpoint] as number);
  return {
    minimum: sorted[0] as number,
    median,
    mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p95: atRank(0.95),
    maximum: sorted.at(-1) as number,
  };
}

function printTimings(label: string, samples: readonly number[]): void {
  const values = summarize(samples);
  console.log(label);
  console.log(`  min: ${values.minimum.toFixed(4)} ms`);
  console.log(`  median: ${values.median.toFixed(4)} ms`);
  console.log(`  mean: ${values.mean.toFixed(4)} ms`);
  console.log(`  p95: ${values.p95.toFixed(4)} ms`);
  console.log(`  max: ${values.maximum.toFixed(4)} ms`);
}

function benchmarkInitialization(
  manifest: unknown,
  matrixBytes: Uint8Array,
): readonly number[] {
  const samples: number[] = [];
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const startedAt = performance.now();
    createCarTravelTimeIndex(manifest, matrixBytes);
    samples.push(performance.now() - startedAt);
  }
  return samples;
}

function benchmarkPointLookup(index: CarTravelTimeIndex): readonly number[] {
  const samples: number[] = [];
  for (let sample = 0; sample < 100; sample += 1) {
    const startedAt = performance.now();
    for (let iteration = 0; iteration < 1_000; iteration += 1) {
      getCarTravelMinutes(index, '8001:zurich', '3011:bern');
    }
    samples.push((performance.now() - startedAt) / 1_000);
  }
  return samples;
}

function benchmarkReachability(
  index: CarTravelTimeIndex,
  maxTravelMinutes: 90 | 240,
): readonly number[] {
  const samples: number[] = [];
  for (let sample = 0; sample < 50; sample += 1) {
    const startedAt = performance.now();
    for (let iteration = 0; iteration < 10; iteration += 1) {
      getReachableLocalitiesByCar(index, '8001:zurich', maxTravelMinutes);
    }
    samples.push((performance.now() - startedAt) / 10);
  }
  return samples;
}

function sourceValueAt(bytes: Uint8Array, cellIndex: number): number {
  const byteIndex = cellIndex * 2;
  return (
    (bytes[byteIndex] as number) |
    ((bytes[byteIndex + 1] as number) << 8)
  );
}

function findCapExamples(
  localityIds: readonly string[],
  sourceMatrixBytes: Uint8Array,
  runtimeMatrixBytes: Uint8Array,
): { readonly retained: MatrixExample; readonly capped: MatrixExample } {
  let retained: MatrixExample | undefined;
  let capped: MatrixExample | undefined;
  const localityCount = localityIds.length;
  for (
    let cellIndex = 0;
    cellIndex < runtimeMatrixBytes.length &&
    (retained === undefined || capped === undefined);
    cellIndex += 1
  ) {
    const sourceMinutes = sourceValueAt(sourceMatrixBytes, cellIndex);
    const runtimeValue = runtimeMatrixBytes[cellIndex] as number;
    const originIndex = Math.floor(cellIndex / localityCount);
    const destinationIndex = cellIndex % localityCount;
    if (
      retained === undefined &&
      sourceMinutes >= 121 &&
      sourceMinutes <= 240 &&
      runtimeValue === sourceMinutes
    ) {
      retained = {
        fromLocalityId: localityIds[originIndex] as string,
        toLocalityId: localityIds[destinationIndex] as string,
        sourceMinutes,
        runtimeMinutes: runtimeValue,
      };
    }
    if (
      capped === undefined &&
      sourceMinutes > 240 &&
      sourceMinutes !== 65_535 &&
      runtimeValue === UNAVAILABLE_TRAVEL_TIME
    ) {
      capped = {
        fromLocalityId: localityIds[originIndex] as string,
        toLocalityId: localityIds[destinationIndex] as string,
        sourceMinutes,
        runtimeMinutes: undefined,
      };
    }
  }
  if (retained === undefined || capped === undefined) {
    throw new Error('Unable to find both retained and capped real car pairs.');
  }
  return { retained, capped };
}

async function main(): Promise<void> {
  const commandStartedAt = performance.now();
  const [
    runtimeManifestBytes,
    runtimeMatrixBytes,
    sourceManifestBytes,
    sourceMatrixBytes,
  ] = await Promise.all([
    readFile(RUNTIME_PATHS.manifestPath),
    readFile(RUNTIME_PATHS.matrixPath),
    readFile(SOURCE_MANIFEST_PATH),
    readFile(SOURCE_MATRIX_PATH),
  ]);
  const runtime = authenticateRuntimeCarData(
    runtimeManifestBytes,
    runtimeMatrixBytes,
    'runtime diagnostic data',
  );
  const source = authenticateSourceCarData(
    sourceManifestBytes,
    sourceMatrixBytes,
    'source diagnostic data',
  );
  if (runtime.manifest.source.sourceMatrixSha256 !== source.matrixSha256) {
    throw new Error('Runtime provenance does not match the authenticated source matrix.');
  }
  if (
    runtime.manifest.matrix.localityIds.some(
      (localityId, index) => localityId !== source.manifest.localityIds[index],
    )
  ) {
    throw new Error('Runtime locality ordering differs from the source matrix.');
  }

  // Authentication constructs and releases a temporary index. Collect it
  // before measuring so the reported delta describes the one live index below.
  globalThis.gc?.();
  const memoryBefore = process.memoryUsage();
  const initializationStartedAt = performance.now();
  const index = createCarTravelTimeIndex(runtime.manifest, runtimeMatrixBytes);
  const oneInitializationMilliseconds = performance.now() - initializationStartedAt;
  globalThis.gc?.();
  const memoryAfter = process.memoryUsage();
  const diagnostics = getCarTravelTimeIndexDiagnostics(index);

  console.log('Authenticated car matrix data:');
  console.log(`  Source UInt16: ${formatBytes(source.matrixByteLength)}`);
  console.log(`  Runtime UInt8: ${formatBytes(runtime.matrixByteLength)}`);
  console.log(`  Runtime SHA-256: ${runtime.matrixSha256}`);
  console.log(`  Manifest SHA-256: ${runtime.manifestSha256}`);
  console.log(`  Localities: ${formatInteger(runtime.manifest.matrix.localityCount)}`);
  console.log('');
  console.log('Runtime storage:');
  console.log(`  Matrix view: ${formatBytes(diagnostics.matrixValuesByteLength)}`);
  console.log(`  Matrix copied: ${diagnostics.matrixBytesCopied}`);
  console.log(
    `  Locality-index entries: ` +
      formatInteger(diagnostics.localityIndexEntryCount),
  );
  console.log(
    `  Heap delta after one index: ` +
      `${formatInteger(memoryAfter.heapUsed - memoryBefore.heapUsed)} bytes`,
  );
  console.log(
    `  ArrayBuffer delta after one index: ` +
      `${formatInteger(memoryAfter.arrayBuffers - memoryBefore.arrayBuffers)} bytes`,
  );
  console.log('');

  console.log('Directional point lookups:');
  for (const [fromLabel, fromId, toLabel, toId] of REFERENCE_PAIRS) {
    const travelMinutes = getCarTravelMinutes(index, fromId, toId);
    console.log(`  ${fromLabel} → ${toLabel}: ${travelMinutes ?? 'unavailable'} min`);
  }
  console.log('');
  console.log('Reachable localities (including origin):');
  for (const origin of REFERENCE_ORIGINS) {
    const counts = REACHABILITY_LIMITS.map((limit) => {
      const count = getReachableLocalitiesByCar(
        index,
        origin.localityId,
        limit,
      ).length;
      return `${limit}: ${formatInteger(count)}`;
    });
    console.log(`  ${origin.label}: ${counts.join(', ')}`);
  }
  console.log('');

  const examples = findCapExamples(
    runtime.manifest.matrix.localityIds,
    sourceMatrixBytes,
    runtimeMatrixBytes,
  );
  console.log('Four-hour cap examples selected from authenticated real data:');
  console.log(
    `  Retained: ${examples.retained.fromLocalityId} → ` +
      `${examples.retained.toLocalityId}; source ` +
      `${examples.retained.sourceMinutes} min, runtime ` +
      `${examples.retained.runtimeMinutes} min`,
  );
  console.log(
    `  Capped: ${examples.capped.fromLocalityId} → ` +
      `${examples.capped.toLocalityId}; source ` +
      `${examples.capped.sourceMinutes} min, runtime unavailable`,
  );
  console.log('');

  console.log(`One initialization: ${oneInitializationMilliseconds.toFixed(4)} ms`);
  printTimings(
    'Initialization benchmark (10 samples):',
    benchmarkInitialization(runtime.manifest, runtimeMatrixBytes),
  );
  printTimings(
    'Point lookup benchmark (100 × 1,000 calls, per call):',
    benchmarkPointLookup(index),
  );
  printTimings(
    'Zürich 90-minute scan benchmark (50 × 10 scans, per scan):',
    benchmarkReachability(index, 90),
  );
  printTimings(
    'Zürich 240-minute scan benchmark (50 × 10 scans, per scan):',
    benchmarkReachability(index, 240),
  );
  console.log(`Total diagnostic time: ${(performance.now() - commandStartedAt).toFixed(3)} ms`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
