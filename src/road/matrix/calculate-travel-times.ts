import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rename,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  calculateTravelTimeMatrixByteLength,
} from '@commute-internal/travel-time-matrix';

import {
  OsrmHttpError,
  OsrmTransportError,
  type RoadNetwork,
} from '../network';
import {
  authenticateRoadMatrixData,
  createRoadTravelTimeManifest,
  publishRoadMatrixArtifacts,
  serializeRoadTravelTimeManifest,
  type AuthenticatedRoadMatrixData,
  type RoadMatrixPublicationPaths,
} from './artifacts';
import {
  createRoadMatrixCheckpoint,
  parseRoadMatrixCheckpointJson,
  serializeRoadMatrixCheckpoint,
  validateRoadMatrixResume,
  type RoadMatrixCheckpoint,
  type RoadMatrixResumeIdentity,
} from './checkpoint';
import {
  createTravelTimeBlock,
  encodeRoadDuration,
  finalizeTravelTimeBlock,
  writeDurationTable,
} from './travel-time-block';

export interface RoadMatrixPaths extends RoadMatrixPublicationPaths {
  readonly workDirectory: string;
}

export interface RoadMatrixConfig {
  readonly blockSize: number;
  readonly requestConcurrency: number;
  readonly maxRequestAttempts: number;
  readonly retryDelaysMilliseconds: readonly number[];
  readonly validationSampleSize: number;
}

export interface RoadMatrixProgress {
  readonly completedOrigins: number;
  readonly totalOrigins: number;
}

export interface CalculateTravelTimesOptions {
  readonly network: RoadNetwork;
  readonly config: RoadMatrixConfig;
  readonly paths: RoadMatrixPaths;
  readonly restart?: boolean;
  readonly onProgress?: (progress: RoadMatrixProgress) => void | Promise<void>;
}

export interface RoadMatrixValidation {
  readonly sampleSize: number;
  readonly exactMatches: number;
}

export interface CalculateTravelTimesResult
  extends AuthenticatedRoadMatrixData {
  readonly validation: RoadMatrixValidation;
}

interface MatrixWorkPaths extends RoadMatrixPaths {
  readonly partialMatrixPath: string;
  readonly checkpointPath: string;
}

interface PairIndexes {
  readonly originIndex: number;
  readonly destinationIndex: number;
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

async function writeUtf8Atomically(
  path: string,
  contents: string,
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await removeIfPresent(temporaryPath);
    throw error;
  }
  await handle.close();
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await removeIfPresent(temporaryPath);
    throw error;
  }
}

function resolvePaths(paths: RoadMatrixPaths): MatrixWorkPaths {
  for (const [description, value] of [
    ['work directory', paths.workDirectory],
    ['manifest path', paths.manifestPath],
    ['matrix path', paths.matrixPath],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError(`Road matrix ${description} is required.`);
    }
  }
  const workDirectory = resolve(paths.workDirectory);
  const manifestPath = resolve(paths.manifestPath);
  const matrixPath = resolve(paths.matrixPath);
  if (manifestPath === matrixPath) {
    throw new Error('Road matrix manifest and binary paths must differ.');
  }
  const isInsideWorkDirectory = (path: string): boolean => {
    const relativePath = relative(workDirectory, path);
    return (
      relativePath === '' ||
      (relativePath !== '..' &&
        !relativePath.startsWith(`..${sep}`) &&
        !isAbsolute(relativePath))
    );
  };
  if (isInsideWorkDirectory(manifestPath) || isInsideWorkDirectory(matrixPath)) {
    throw new Error(
      'Road matrix publication must be outside its work directory.',
    );
  }
  return {
    workDirectory,
    manifestPath,
    matrixPath,
    partialMatrixPath: resolve(workDirectory, 'travel-times.bin.partial'),
    checkpointPath: resolve(workDirectory, 'checkpoint.json'),
  };
}

function validateConfig(config: RoadMatrixConfig): void {
  for (const [value, description] of [
    [config.blockSize, 'block size'],
    [config.requestConcurrency, 'request concurrency'],
    [config.maxRequestAttempts, 'maximum request attempts'],
    [config.validationSampleSize, 'validation sample size'],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`Road matrix ${description} must be positive.`);
    }
  }
  if (config.blockSize * 2 > 100) {
    throw new RangeError('Road matrix block size exceeds OSRM table limits.');
  }
  if (config.retryDelaysMilliseconds.length < config.maxRequestAttempts - 1) {
    throw new RangeError('Road matrix retry delays do not cover every retry.');
  }
  if (
    config.retryDelaysMilliseconds.some(
      (milliseconds) => !Number.isFinite(milliseconds) || milliseconds < 0,
    )
  ) {
    throw new RangeError('Road matrix retry delays must be nonnegative.');
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function isTransientOsrmError(error: unknown): boolean {
  return (
    error instanceof OsrmTransportError ||
    (error instanceof OsrmHttpError &&
      (error.status === 408 ||
        error.status === 429 ||
        (error.status >= 500 && error.status <= 599)))
  );
}

async function retry<T>(
  action: () => Promise<T>,
  config: RoadMatrixConfig,
  description: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxRequestAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (
        !isTransientOsrmError(error) ||
        attempt === config.maxRequestAttempts
      ) {
        break;
      }
      await sleep(config.retryDelaysMilliseconds[attempt - 1] as number);
    }
  }
  throw new Error(`${description} failed.`, { cause: lastError });
}

async function runBoundedTasks(
  itemCount: number,
  concurrency: number,
  task: (itemIndex: number) => Promise<void>,
): Promise<void> {
  let nextItemIndex = 0;
  let firstError: unknown;
  async function worker(): Promise<void> {
    while (firstError === undefined && nextItemIndex < itemCount) {
      const itemIndex = nextItemIndex;
      nextItemIndex += 1;
      try {
        await task(itemIndex);
      } catch (error) {
        firstError ??= error;
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, itemCount) },
      async () => worker(),
    ),
  );
  if (firstError !== undefined) {
    throw firstError;
  }
}

function resumeIdentity(
  network: RoadNetwork,
  config: RoadMatrixConfig,
): RoadMatrixResumeIdentity {
  return {
    localityCount: network.localities.length,
    blockSize: config.blockSize,
    maxTravelMinutes: COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
    valueEncoding: 'UINT8',
    anchorsSha256: network.anchorsSha256,
  };
}

async function initializeOrResume(
  paths: MatrixWorkPaths,
  identity: RoadMatrixResumeIdentity,
  restart: boolean,
): Promise<RoadMatrixCheckpoint> {
  await mkdir(paths.workDirectory, { recursive: true });
  if (restart) {
    await Promise.all([
      removeIfPresent(paths.partialMatrixPath),
      removeIfPresent(paths.checkpointPath),
    ]);
  }
  const [partialSize, checkpointSize, completedMatrixSize] = await Promise.all([
    regularFileSize(paths.partialMatrixPath),
    regularFileSize(paths.checkpointPath),
    regularFileSize(paths.matrixPath),
  ]);
  if ((partialSize === undefined) !== (checkpointSize === undefined)) {
    throw new Error(
      'Road matrix resume state is incomplete. Use --restart to start over.',
    );
  }
  if (partialSize !== undefined && checkpointSize !== undefined) {
    const checkpoint = parseRoadMatrixCheckpointJson(
      await readFile(paths.checkpointPath, 'utf8'),
      paths.checkpointPath,
    );
    validateRoadMatrixResume(checkpoint, identity, partialSize);
    return checkpoint;
  }
  if (!restart && completedMatrixSize !== undefined) {
    throw new Error(
      'A completed road matrix already exists. Use --restart to rebuild it.',
    );
  }
  const handle = await open(paths.partialMatrixPath, 'wx');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const checkpoint = createRoadMatrixCheckpoint(identity, 0);
  await writeUtf8Atomically(
    paths.checkpointPath,
    serializeRoadMatrixCheckpoint(checkpoint),
  );
  return checkpoint;
}

async function appendCompletedRows(
  path: string,
  bytes: Uint8Array,
  expectedOffset: number,
): Promise<void> {
  if ((await regularFileSize(path)) !== expectedOffset) {
    throw new Error('Road partial matrix does not match checkpoint progress.');
  }
  const handle = await open(path, 'r+');
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
        throw new Error('Road partial-matrix write made no progress.');
      }
      written += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const expectedSize = expectedOffset + bytes.byteLength;
  if ((await regularFileSize(path)) !== expectedSize) {
    throw new Error(
      `Road partial matrix did not reach its expected ${expectedSize} bytes.`,
    );
  }
}

function validationPairs(
  network: RoadNetwork,
  requestedCount: number,
  seed: string,
): readonly PairIndexes[] {
  const localityCount = network.localities.length;
  const pairCount = Math.min(
    requestedCount,
    localityCount * Math.max(localityCount - 1, 0),
  );
  if (pairCount === 0) {
    return [];
  }
  let state = Number.parseInt(seed.slice(0, 8), 16) >>> 0;
  if (state === 0) {
    state = 0x9e37_79b9;
  }
  const randomUint32 = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  const pairs: PairIndexes[] = [];
  const seen = new Set<string>();
  const indexByLocalityId = new Map(
    network.localities.map(({ localityId }, index) => [localityId, index]),
  );
  for (const [originId, destinationId] of [
    ['8001:zurich', '3011:bern'],
    ['3011:bern', '8001:zurich'],
    ['8750:glarus', '8001:zurich'],
    ['8001:zurich', '8750:glarus'],
    ['3920:zermatt', '3930:visp'],
    ['3930:visp', '3920:zermatt'],
  ] as const) {
    const originIndex = indexByLocalityId.get(originId);
    const destinationIndex = indexByLocalityId.get(destinationId);
    if (
      pairs.length < pairCount &&
      originIndex !== undefined &&
      destinationIndex !== undefined
    ) {
      pairs.push({ originIndex, destinationIndex });
      seen.add(`${originIndex}:${destinationIndex}`);
    }
  }
  while (pairs.length < pairCount) {
    const originIndex = randomUint32() % localityCount;
    const destinationIndex = randomUint32() % localityCount;
    const key = `${originIndex}:${destinationIndex}`;
    if (originIndex !== destinationIndex && !seen.has(key)) {
      seen.add(key);
      pairs.push({ originIndex, destinationIndex });
    }
  }
  return pairs;
}

async function validateIndependentSample(
  network: RoadNetwork,
  matrixBytes: Uint8Array,
  config: RoadMatrixConfig,
): Promise<RoadMatrixValidation> {
  const pairs = validationPairs(
    network,
    config.validationSampleSize,
    network.anchorsSha256,
  );
  let exactMatches = 0;
  await runBoundedTasks(
    pairs.length,
    config.requestConcurrency,
    async (index) => {
      const pair = pairs[index] as PairIndexes;
      const route = await retry(
        () =>
          network.router.estimateRoute(
            network.localities[pair.originIndex]!,
            network.localities[pair.destinationIndex]!,
          ),
        config,
        `OSRM route validation ${pair.originIndex} → ${pair.destinationIndex}`,
      );
      const expected = encodeRoadDuration(route?.durationSeconds);
      const actual =
        matrixBytes[
          pair.originIndex * network.localities.length + pair.destinationIndex
        ] as number;
      if (actual !== expected) {
        throw new Error(
          `Road matrix validation mismatch for ${network.localities[pair.originIndex]?.localityId} → ${network.localities[pair.destinationIndex]?.localityId}: matrix ${actual}, route ${expected}.`,
        );
      }
      exactMatches += 1;
    },
  );
  return { sampleSize: pairs.length, exactMatches };
}

async function finalizeMatrix(
  paths: MatrixWorkPaths,
  network: RoadNetwork,
  config: RoadMatrixConfig,
): Promise<CalculateTravelTimesResult> {
  const matrixBytes = await readFile(paths.partialMatrixPath);
  const expectedByteLength = calculateTravelTimeMatrixByteLength(
    network.localities.length,
  );
  if (matrixBytes.byteLength !== expectedByteLength) {
    throw new Error(
      `Completed road matrix has ${matrixBytes.byteLength} bytes; expected ${expectedByteLength}.`,
    );
  }
  const manifestBytes = serializeRoadTravelTimeManifest(
    createRoadTravelTimeManifest(network, matrixBytes),
  );
  authenticateRoadMatrixData(manifestBytes, matrixBytes, 'completed road matrix');
  const validation = await validateIndependentSample(
    network,
    matrixBytes,
    config,
  );
  const published = await publishRoadMatrixArtifacts(
    manifestBytes,
    matrixBytes,
    paths,
  );
  await Promise.all([
    unlink(paths.checkpointPath),
    unlink(paths.partialMatrixPath),
  ]);
  await rmdir(paths.workDirectory);
  return { ...published, validation };
}

/** Calculates, validates, and atomically publishes the final road matrix. */
export async function calculateTravelTimes(
  options: CalculateTravelTimesOptions,
): Promise<CalculateTravelTimesResult> {
  validateConfig(options.config);
  const paths = resolvePaths(options.paths);
  const localityCount = options.network.localities.length;
  const identity = resumeIdentity(options.network, options.config);
  let checkpoint = await initializeOrResume(
    paths,
    identity,
    options.restart ?? false,
  );
  const destinationBlockCount = Math.ceil(
    localityCount / options.config.blockSize,
  );

  while (checkpoint.nextOriginIndex < localityCount) {
    const originStart = checkpoint.nextOriginIndex;
    const originEnd = Math.min(
      originStart + options.config.blockSize,
      localityCount,
    );
    const origins = options.network.localities.slice(originStart, originEnd);
    const block = createTravelTimeBlock(origins.length, localityCount);
    await runBoundedTasks(
      destinationBlockCount,
      options.config.requestConcurrency,
      async (destinationBlockIndex) => {
        const destinationStart =
          destinationBlockIndex * options.config.blockSize;
        const destinationEnd = Math.min(
          destinationStart + options.config.blockSize,
          localityCount,
        );
        const destinations = options.network.localities.slice(
          destinationStart,
          destinationEnd,
        );
        const table = await retry(
          () => options.network.router.getDurationTable(origins, destinations),
          options.config,
          `OSRM table rows ${originStart}-${originEnd - 1}, columns ${destinationStart}-${destinationEnd - 1}`,
        );
        writeDurationTable(
          block,
          destinationStart,
          destinations.length,
          table,
        );
      },
    );
    const completedRows = finalizeTravelTimeBlock(block, originStart);
    await appendCompletedRows(
      paths.partialMatrixPath,
      completedRows,
      originStart * localityCount,
    );
    checkpoint = createRoadMatrixCheckpoint(identity, originEnd);
    await writeUtf8Atomically(
      paths.checkpointPath,
      serializeRoadMatrixCheckpoint(checkpoint),
    );
    await options.onProgress?.({
      completedOrigins: originEnd,
      totalOrigins: localityCount,
    });
  }

  return await finalizeMatrix(paths, options.network, options.config);
}
