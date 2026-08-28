import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import {
  createTransitTravelTimeMatrixCheckpoint,
  createTransitTravelTimeMatrixRowGenerator,
  parseTransitTravelTimeMatrixCheckpointJson,
  serializeTransitTravelTimeMatrixCheckpoint,
  validateTransitTravelTimeMatrixResume,
  type TransitTravelTimeMatrixCheckpoint,
  type TransitTravelTimeMatrixResumeIdentity,
} from '@core/transit/preprocessing';
import {
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  UNAVAILABLE_TRAVEL_TIME,
} from '@commute-internal/travel-time-matrix';

import { writeUtf8FileAtomically } from '../write-utf8-file-atomically';
import {
  authenticateTransitMatrixData,
  createTransitTravelTimeManifest,
  publishTransitMatrixArtifacts,
  serializeTransitTravelTimeManifest,
} from './transit-matrix-artifacts';
import {
  loadTransitMatrixCompilerInputs,
  type LoadedTransitMatrixCompilerInputs,
} from './transit-matrix-inputs';
import {
  TRANSIT_MATRIX_WORK_DIRECTORY,
  TRANSIT_RUNTIME_DIRECTORY,
} from './paths';

const PARTIAL_MATRIX_PATH = resolve(
  TRANSIT_MATRIX_WORK_DIRECTORY,
  'travel-times.bin.partial',
);
const CHECKPOINT_PATH = resolve(
  TRANSIT_MATRIX_WORK_DIRECTORY,
  'checkpoint.json',
);
const MATRIX_PATH = resolve(TRANSIT_RUNTIME_DIRECTORY, 'travel-times.bin');
const MANIFEST_PATH = resolve(TRANSIT_RUNTIME_DIRECTORY, 'manifest.json');

const CHECKPOINT_ORIGIN_BLOCK_SIZE = 10;
const PROGRESS_ORIGIN_INTERVAL = 250;
const BENCHMARK_ORIGIN_COUNT = 50;
const VALIDATION_ORIGIN_COUNT = 20;
const VALIDATION_DESTINATIONS_PER_ORIGIN = 5;
const REFERENCE_LOCALITY_IDS = [
  '8001:zurich',
  '3011:bern',
  '8750:glarus',
  '3920:zermatt',
  '3930:visp',
] as const;

interface DurationStatistics {
  readonly minimum: number;
  readonly median: number;
  readonly mean: number;
  readonly p95: number;
  readonly maximum: number;
}

interface BenchmarkResult extends DurationStatistics {
  readonly sampleSize: number;
  readonly estimatedFullGenerationMilliseconds: number;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) {
    return 'unknown';
  }
  const seconds = Math.max(Math.round(milliseconds / 1_000), 0);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return [
    ...(hours > 0 ? [`${hours}h`] : []),
    ...(hours > 0 || minutes > 0 ? [`${minutes}m`] : []),
    `${remainingSeconds}s`,
  ].join(' ');
}

function summarizeDurations(values: readonly number[]): DurationStatistics {
  const sorted = values.toSorted((left, right) => left - right);
  if (sorted.length === 0) {
    throw new Error('Cannot summarize an empty duration sample.');
  }
  const nearestRank = (fraction: number): number =>
    sorted[Math.max(Math.ceil(sorted.length * fraction) - 1, 0)] as number;
  return {
    minimum: sorted[0] as number,
    median: nearestRank(0.5),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: nearestRank(0.95),
    maximum: sorted.at(-1) as number,
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function regularFileSize(path: string): Promise<number | undefined> {
  let fileStat: Stats;
  try {
    fileStat = await stat(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new Error(`Expected a regular file at "${path}".`);
  }
  return fileStat.size;
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

function deterministicOriginSample(
  localityIds: readonly string[],
  count: number,
): readonly number[] {
  const indexes: number[] = [];
  const seen = new Set<number>();
  const add = (index: number): void => {
    if (index >= 0 && !seen.has(index)) {
      seen.add(index);
      indexes.push(index);
    }
  };
  for (const localityId of REFERENCE_LOCALITY_IDS) {
    add(localityIds.indexOf(localityId));
  }
  for (let sampleIndex = 0; indexes.length < count; sampleIndex += 1) {
    add(
      Math.floor(
        (sampleIndex * (localityIds.length - 1)) /
          Math.max(count - 1, 1),
      ),
    );
  }
  return indexes.slice(0, count);
}

function runBenchmark(
  inputs: LoadedTransitMatrixCompilerInputs,
): BenchmarkResult {
  const localityIds = inputs.localityIds;
  const rowGenerator = createTransitTravelTimeMatrixRowGenerator(
    localityIds,
    inputs.queryReachableLocalities,
  );
  const samples = deterministicOriginSample(
    localityIds,
    BENCHMARK_ORIGIN_COUNT,
  );
  const durations: number[] = [];
  for (const originIndex of samples) {
    const startedAt = performance.now();
    rowGenerator.generateRow(originIndex);
    durations.push(performance.now() - startedAt);
  }
  const statistics = summarizeDurations(durations);
  return {
    sampleSize: samples.length,
    ...statistics,
    estimatedFullGenerationMilliseconds:
      statistics.mean * inputs.localityIds.length,
  };
}

function printBenchmark(result: BenchmarkResult): void {
  console.log(`50-origin benchmark (${result.sampleSize} deterministic origins):`);
  console.log(`  minimum: ${result.minimum.toFixed(3)} ms`);
  console.log(`  median: ${result.median.toFixed(3)} ms`);
  console.log(`  mean: ${result.mean.toFixed(3)} ms`);
  console.log(`  p95: ${result.p95.toFixed(3)} ms`);
  console.log(`  maximum: ${result.maximum.toFixed(3)} ms`);
  console.log(
    `  estimated full serial generation: ${formatDuration(result.estimatedFullGenerationMilliseconds)}`,
  );
}

function resumeIdentity(
  inputs: LoadedTransitMatrixCompilerInputs,
): TransitTravelTimeMatrixResumeIdentity {
  const queryPolicySha256 = createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        serviceDate: inputs.source.serviceDate,
        morningWindow: inputs.source.morningWindow,
        maxTransfers: inputs.source.routingPolicy.maxTransfers,
        minTransferTimeSeconds:
          inputs.source.routingPolicy.minTransferTimeSeconds,
      }),
    )
    .digest('hex');
  return {
    localityCount: inputs.localityIds.length,
    maxTravelMinutes: COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
    valueEncoding: 'UINT8',
    routingDataFingerprint: inputs.source.routingDataFingerprint,
    timetableFingerprint: inputs.source.timetableFingerprint,
    localityRoutingIndexSha256:
      inputs.source.localityRoutingIndexSha256,
    queryPolicySha256,
  };
}

async function initializeOrResume(
  identity: TransitTravelTimeMatrixResumeIdentity,
  restart: boolean,
): Promise<TransitTravelTimeMatrixCheckpoint> {
  await mkdir(TRANSIT_MATRIX_WORK_DIRECTORY, { recursive: true });
  if (restart) {
    await removeIfPresent(PARTIAL_MATRIX_PATH);
    await removeIfPresent(CHECKPOINT_PATH);
    console.log(
      'Restart requested: discarded only partial transit progress; the completed runtime matrix remains available until final promotion.',
    );
  }

  const [partialSize, checkpointSize, completedMatrixSize] =
    await Promise.all([
      regularFileSize(PARTIAL_MATRIX_PATH),
      regularFileSize(CHECKPOINT_PATH),
      regularFileSize(MATRIX_PATH),
    ]);
  if ((partialSize === undefined) !== (checkpointSize === undefined)) {
    if (
      partialSize === undefined &&
      checkpointSize !== undefined &&
      completedMatrixSize !== undefined
    ) {
      throw new Error(
        'Transit checkpoint exists without its partial matrix. Use --restart to intentionally start over.',
      );
    }
    throw new Error(
      'Transit resume state is incomplete: partial binary and checkpoint must both exist. Use --restart to intentionally start over.',
    );
  }
  if (partialSize !== undefined && checkpointSize !== undefined) {
    const checkpoint = parseTransitTravelTimeMatrixCheckpointJson(
      await readFile(CHECKPOINT_PATH, 'utf8'),
      CHECKPOINT_PATH,
    );
    validateTransitTravelTimeMatrixResume(checkpoint, identity, partialSize);
    console.log(
      `Resuming validated transit matrix at origin ${checkpoint.nextOriginIndex}.`,
    );
    return checkpoint;
  }
  if (!restart && completedMatrixSize !== undefined) {
    throw new Error(
      'A completed runtime transit matrix already exists. Use --restart for an intentional deterministic rebuild.',
    );
  }

  const handle = await open(PARTIAL_MATRIX_PATH, 'wx');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const checkpoint = createTransitTravelTimeMatrixCheckpoint(identity, 0);
  await writeUtf8FileAtomically(
    CHECKPOINT_PATH,
    serializeTransitTravelTimeMatrixCheckpoint(checkpoint),
  );
  return checkpoint;
}

async function appendCompletedRows(
  bytes: Uint8Array,
  expectedOffset: number,
): Promise<void> {
  const currentSize = await regularFileSize(PARTIAL_MATRIX_PATH);
  if (currentSize !== expectedOffset) {
    throw new Error(
      `Partial transit matrix has ${currentSize ?? 'no'} bytes before append; expected ${expectedOffset}.`,
    );
  }
  const handle = await open(PARTIAL_MATRIX_PATH, 'r+');
  try {
    let written = 0;
    while (written < bytes.byteLength) {
      const result = await handle.write(
        bytes,
        written,
        bytes.byteLength - written,
        expectedOffset + written,
      );
      if (result.bytesWritten === 0) {
        throw new Error('Transit partial-matrix append made no progress.');
      }
      written += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const actualSize = await regularFileSize(PARTIAL_MATRIX_PATH);
  if (actualSize !== expectedOffset + bytes.byteLength) {
    throw new Error(
      `Partial transit matrix has ${actualSize ?? 'no'} bytes after append; expected ${expectedOffset + bytes.byteLength}.`,
    );
  }
}

function queryResultMap(
  inputs: LoadedTransitMatrixCompilerInputs,
  originIndex: number,
): ReadonlyMap<string, number> {
  const originLocalityId = inputs.localityIds[originIndex];
  if (originLocalityId === undefined) {
    throw new Error(`Missing locality ${originIndex}.`);
  }
  const values = new Map<string, number>();
  for (const result of inputs.queryReachableLocalities(
    originLocalityId,
    COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  )) {
    values.set(result.localityId, result.travelMinutes);
  }
  values.set(originLocalityId, 0);
  return values;
}

function validateIndependentSample(
  inputs: LoadedTransitMatrixCompilerInputs,
  matrixBytes: Uint8Array,
): { readonly sampleSize: number; readonly exactMatches: number } {
  const localityIds = inputs.localityIds;
  const localityCount = localityIds.length;
  const origins = deterministicOriginSample(
    localityIds,
    VALIDATION_ORIGIN_COUNT,
  );
  let sampleSize = 0;
  let exactMatches = 0;
  for (const originIndex of origins) {
    const expectedById = queryResultMap(inputs, originIndex);
    const destinationIndexes = new Set<number>();
    for (const offset of [
      1,
      17,
      Math.floor(localityCount / 3),
      Math.floor((localityCount * 2) / 3),
      localityCount - 1,
    ]) {
      const destinationIndex = (originIndex + offset) % localityCount;
      if (destinationIndex !== originIndex) {
        destinationIndexes.add(destinationIndex);
      }
    }
    for (
      let candidate = 1;
      destinationIndexes.size < VALIDATION_DESTINATIONS_PER_ORIGIN;
      candidate += 1
    ) {
      const destinationIndex = (originIndex + candidate) % localityCount;
      if (destinationIndex !== originIndex) {
        destinationIndexes.add(destinationIndex);
      }
    }
    for (const destinationIndex of [...destinationIndexes].slice(
      0,
      VALIDATION_DESTINATIONS_PER_ORIGIN,
    )) {
      const destinationId = localityIds[destinationIndex] as string;
      const expected = expectedById.get(destinationId);
      const rawValue = matrixBytes[
        originIndex * localityCount + destinationIndex
      ] as number;
      const actual =
        rawValue === UNAVAILABLE_TRAVEL_TIME ? undefined : rawValue;
      sampleSize += 1;
      if (actual !== expected) {
        throw new Error(
          `Independent RAPTOR validation mismatch for ${localityIds[originIndex]} → ${destinationId}: matrix ${actual ?? 'unavailable'}, query ${expected ?? 'unavailable'}.`,
        );
      }
      exactMatches += 1;
    }
  }
  return { sampleSize, exactMatches };
}

async function finalizeMatrix(
  inputs: LoadedTransitMatrixCompilerInputs,
): Promise<void> {
  const matrixBytes = await readFile(PARTIAL_MATRIX_PATH);
  const manifest = createTransitTravelTimeManifest(
    inputs.localityIds,
    matrixBytes,
    inputs.source,
  );
  const manifestBytes = serializeTransitTravelTimeManifest(manifest);
  authenticateTransitMatrixData(
    manifestBytes,
    matrixBytes,
    'completed transit matrix',
  );
  const validation = validateIndependentSample(inputs, matrixBytes);
  const authenticated = await publishTransitMatrixArtifacts(
    manifestBytes,
    matrixBytes,
    { manifestPath: MANIFEST_PATH, matrixPath: MATRIX_PATH },
  );
  await Promise.all([unlink(CHECKPOINT_PATH), unlink(PARTIAL_MATRIX_PATH)]);
  await rmdir(TRANSIT_MATRIX_WORK_DIRECTORY);

  console.log(
    `Independent RAPTOR validation: ${validation.exactMatches}/${validation.sampleSize} exact matches.`,
  );
  console.log(`Matrix size: ${formatInteger(authenticated.matrixByteLength)} bytes`);
  console.log(`Matrix SHA-256: ${authenticated.matrixSha256}`);
  console.log(`Manifest size: ${formatInteger(authenticated.manifestByteLength)} bytes`);
  console.log(`Manifest SHA-256: ${authenticated.manifestSha256}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      restart: { type: 'boolean', default: false },
      'benchmark-only': { type: 'boolean', default: false },
      'validate-only': { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  console.log(
    'Loading the prepared routing dataset and building one in-memory RAPTOR compiler state...',
  );
  console.log(
    'Note: no transfer graph is persisted yet, so the existing bridge reads the already-present local GTFS calendar/transfer files once; it does not download or rewrite them.',
  );
  const inputs = await loadTransitMatrixCompilerInputs();
  console.log(
    `Input construction: ${formatDuration(inputs.totalLoadMilliseconds)} (timetable ${formatDuration(inputs.timetableBuildMilliseconds)}, transfers ${formatDuration(inputs.transferBuildMilliseconds)}, fingerprints ${formatDuration(inputs.fingerprintMilliseconds)})`,
  );
  console.log(
    `Canonical locality ordering: ${inputs.localityIds.length} entries from the authenticated locality-routing index.`,
  );
  console.log(`Timetable fingerprint: ${inputs.source.timetableFingerprint}`);

  if (values['validate-only']) {
    const [manifestBytes, matrixBytes] = await Promise.all([
      readFile(MANIFEST_PATH),
      readFile(MATRIX_PATH),
    ]);
    authenticateTransitMatrixData(
      manifestBytes,
      matrixBytes,
      'runtime transit matrix validation input',
    );
    const expectedManifestBytes = serializeTransitTravelTimeManifest(
      createTransitTravelTimeManifest(
        inputs.localityIds,
        matrixBytes,
        inputs.source,
      ),
    );
    if (!manifestBytes.equals(expectedManifestBytes)) {
      throw new Error(
        'Runtime transit manifest does not match the current compiler inputs.',
      );
    }
    const validation = validateIndependentSample(inputs, matrixBytes);
    console.log(
      `Independent non-self RAPTOR validation: ${validation.exactMatches}/${validation.sampleSize} exact matches.`,
    );
    return;
  }

  if (values['benchmark-only']) {
    printBenchmark(runBenchmark(inputs));
    return;
  }

  const identity = resumeIdentity(inputs);
  let checkpoint = await initializeOrResume(identity, values.restart);
  const localityCount = inputs.localityIds.length;
  const rowGenerator = createTransitTravelTimeMatrixRowGenerator(
    inputs.localityIds,
    inputs.queryReachableLocalities,
  );
  const generationStartedAt = performance.now();
  const startOriginIndex = checkpoint.nextOriginIndex;

  while (checkpoint.nextOriginIndex < localityCount) {
    const originStart = checkpoint.nextOriginIndex;
    const originEnd = Math.min(
      originStart + CHECKPOINT_ORIGIN_BLOCK_SIZE,
      localityCount,
    );
    const blockStartedAt = performance.now();
    const completedRows = new Uint8Array(
      (originEnd - originStart) * localityCount,
    );
    for (let originIndex = originStart; originIndex < originEnd; originIndex += 1) {
      const row = rowGenerator.generateRow(originIndex);
      completedRows.set(row, (originIndex - originStart) * localityCount);
    }
    await appendCompletedRows(
      completedRows,
      originStart * localityCount,
    );
    checkpoint = createTransitTravelTimeMatrixCheckpoint(identity, originEnd);
    await writeUtf8FileAtomically(
      CHECKPOINT_PATH,
      serializeTransitTravelTimeMatrixCheckpoint(checkpoint),
    );

    if (
      originEnd === localityCount ||
      Math.floor(originEnd / PROGRESS_ORIGIN_INTERVAL) !==
        Math.floor(originStart / PROGRESS_ORIGIN_INTERVAL)
    ) {
      const elapsed = performance.now() - generationStartedAt;
      const completedThisRun = originEnd - startOriginIndex;
      const averagePerOrigin = elapsed / completedThisRun;
      console.log(
        `Origins ${formatInteger(originEnd)} / ${formatInteger(localityCount)}; ` +
          `last block ${formatDuration(performance.now() - blockStartedAt)}; ` +
          `average ${averagePerOrigin.toFixed(1)} ms/origin; ` +
          `elapsed ${formatDuration(elapsed)}; ` +
          `remaining ${formatDuration((localityCount - originEnd) * averagePerOrigin)}; ` +
          `cells ${formatInteger(originEnd * localityCount)}`,
      );
    }
  }

  if (checkpoint.nextOriginIndex !== localityCount) {
    throw new Error('Transit generation ended before every origin completed.');
  }
  console.log(
    `Full row generation for this run: ${formatDuration(performance.now() - generationStartedAt)}.`,
  );
  await finalizeMatrix(inputs);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
