import { createHash, randomUUID } from 'node:crypto';
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

import type { LocalityId } from '@jobmate/commute';
import {
  matrixByteLength,
  MAX_TRAVEL_MINUTES,
  UNAVAILABLE_TRAVEL_TIME,
} from '@commute-internal/matrix';

import type { LocalityRoutingStopIndex } from '../network/localities/types';
import type { PublicTransportNetwork } from '../network/timetable/types';
import {
  publishMatrixArtifact,
  type MatrixArtifactPaths,
  type PublishedMatrixArtifact,
} from '../../runtime';
import {
  createTransitTravelTimeMatrixCheckpoint,
  parseTransitTravelTimeMatrixCheckpointJson,
  serializeTransitTravelTimeMatrixCheckpoint,
  validateTransitTravelTimeMatrixResume,
  type TransitTravelTimeMatrixCheckpoint,
  type TransitTravelTimeMatrixResumeIdentity,
} from './checkpoint';
import { createRaptorReachabilityQuery } from './reachability-query';
import {
  createLocalityRoutingIndexFingerprint,
  createRaptorTimetableFingerprint,
} from './timetable-fingerprint';
import {
  createTransitTravelTimeMatrixRowGenerator,
  type TransitReachabilityQuery,
} from './travel-time-row';

const CHECKPOINT_ORIGIN_BLOCK_SIZE = 10;
const VALIDATION_ORIGIN_COUNT = 20;
const VALIDATION_DESTINATIONS_PER_ORIGIN = 5;

export interface PublicTransportMatrixPaths
  extends MatrixArtifactPaths {
  readonly workDirectory: string;
}

export interface TravelTimeMatrixProgress {
  readonly completedOrigins: number;
  readonly totalOrigins: number;
}

/** Provenance and routing policy that cannot be derived from compiler inputs. */
export interface PublicTransportMatrixProvenance {
  readonly serviceDate: string;
  readonly morningWindow: {
    readonly start: string;
    readonly end: string;
  };
  readonly gtfsFeedVersion: string;
  readonly routingDataFingerprint: string;
  readonly maxTransfers: number;
  readonly minTransferTimeSeconds: number;
}

export interface CalculateTravelTimesOptions {
  readonly network: PublicTransportNetwork;
  readonly localityRoutingIndex: LocalityRoutingStopIndex;
  readonly provenance: PublicTransportMatrixProvenance;
  readonly paths: PublicTransportMatrixPaths;
  readonly restart?: boolean;
  readonly onProgress?: (
    progress: TravelTimeMatrixProgress,
  ) => void | Promise<void>;
}

export interface TravelTimeMatrixValidation {
  readonly sampleSize: number;
  readonly exactMatches: number;
}

export interface PublicTransportArtifactSource {
  readonly gtfsFeed: string;
  readonly serviceDate: string;
  readonly morningWindow: string;
}

export interface CalculateTravelTimesResult
  extends PublishedMatrixArtifact<PublicTransportArtifactSource> {
  readonly validation: TravelTimeMatrixValidation;
}

interface MatrixWorkPaths {
  readonly workDirectory: string;
  readonly partialMatrixPath: string;
  readonly checkpointPath: string;
  readonly manifestPath: string;
  readonly matrixPath: string;
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

function resolvePaths(paths: PublicTransportMatrixPaths): MatrixWorkPaths {
  for (const [description, value] of [
    ['work directory', paths.workDirectory],
    ['manifest path', paths.manifestPath],
    ['matrix path', paths.matrixPath],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError(`Public-transport matrix ${description} is required.`);
    }
  }
  const workDirectory = resolve(paths.workDirectory);
  const manifestPath = resolve(paths.manifestPath);
  const matrixPath = resolve(paths.matrixPath);
  if (manifestPath === matrixPath) {
    throw new Error('Transit matrix manifest and binary paths must differ.');
  }

  const isContainedByWorkDirectory = (path: string): boolean => {
    const relativePath = relative(workDirectory, path);
    return (
      relativePath === '' ||
      (relativePath !== '..' &&
        !relativePath.startsWith(`..${sep}`) &&
        !isAbsolute(relativePath))
    );
  };
  if (
    isContainedByWorkDirectory(manifestPath) ||
    isContainedByWorkDirectory(matrixPath)
  ) {
    throw new Error(
      'Transit matrix publication paths must be outside the work directory.',
    );
  }
  return {
    workDirectory,
    partialMatrixPath: resolve(workDirectory, 'travel-times.bin.partial'),
    checkpointPath: resolve(workDirectory, 'checkpoint.json'),
    manifestPath,
    matrixPath,
  };
}

function parseClockTimeSeconds(value: string, description: string): number {
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d):([0-5]\d)$/u.exec(value);
  if (match === null) {
    throw new Error(`${description} must be HH:MM:SS within a civil day.`);
  }
  return (
    Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])
  );
}

function createQuery(options: CalculateTravelTimesOptions) {
  const windowStartSeconds = parseClockTimeSeconds(
    options.provenance.morningWindow.start,
    'Transit morning-window start',
  );
  const windowEndSeconds = parseClockTimeSeconds(
    options.provenance.morningWindow.end,
    'Transit morning-window end',
  );
  if (
    windowStartSeconds !== options.network.routingWindowStartSeconds ||
    windowEndSeconds !== options.network.routingWindowEndSeconds
  ) {
    throw new Error(
      `Transit matrix morning window ${windowStartSeconds}-${windowEndSeconds} does not match network routing window ${options.network.routingWindowStartSeconds}-${options.network.routingWindowEndSeconds}.`,
    );
  }
  return createRaptorReachabilityQuery({
    network: options.network,
    localityRoutingIndex: options.localityRoutingIndex,
    windowStartSeconds,
    windowEndSeconds,
    maxTransfers: options.provenance.maxTransfers,
    minTransferTimeSeconds: options.provenance.minTransferTimeSeconds,
  });
}

function createManifestSource(
  options: CalculateTravelTimesOptions,
): PublicTransportArtifactSource {
  return {
    serviceDate: options.provenance.serviceDate,
    morningWindow:
      `${options.provenance.morningWindow.start}-${options.provenance.morningWindow.end}`,
    gtfsFeed: options.provenance.gtfsFeedVersion,
  };
}

function resumeIdentity(
  localityCount: number,
  options: CalculateTravelTimesOptions,
): TransitTravelTimeMatrixResumeIdentity {
  const queryPolicySha256 = createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        serviceDate: options.provenance.serviceDate,
        morningWindow: options.provenance.morningWindow,
        maxTransfers: options.provenance.maxTransfers,
        minTransferTimeSeconds: options.provenance.minTransferTimeSeconds,
      }),
    )
    .digest('hex');
  return {
    localityCount,
    maxTravelMinutes: MAX_TRAVEL_MINUTES,
    valueEncoding: 'UINT8',
    routingDataFingerprint: options.provenance.routingDataFingerprint,
    timetableFingerprint: createRaptorTimetableFingerprint(options.network),
    localityRoutingIndexSha256: createLocalityRoutingIndexFingerprint(
      options.localityRoutingIndex,
    ),
    queryPolicySha256,
  };
}

async function initializeOrResume(
  paths: MatrixWorkPaths,
  identity: TransitTravelTimeMatrixResumeIdentity,
  restart: boolean,
): Promise<TransitTravelTimeMatrixCheckpoint> {
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
      'Transit matrix resume state is incomplete. Use restart to intentionally start over.',
    );
  }
  if (partialSize !== undefined && checkpointSize !== undefined) {
    const checkpoint = parseTransitTravelTimeMatrixCheckpointJson(
      await readFile(paths.checkpointPath, 'utf8'),
      paths.checkpointPath,
    );
    validateTransitTravelTimeMatrixResume(checkpoint, identity, partialSize);
    return checkpoint;
  }
  if (!restart && completedMatrixSize !== undefined) {
    throw new Error(
      'A completed transit matrix already exists. Use restart for an intentional rebuild.',
    );
  }

  const handle = await open(paths.partialMatrixPath, 'wx');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const checkpoint = createTransitTravelTimeMatrixCheckpoint(identity, 0);
  await writeUtf8Atomically(
    paths.checkpointPath,
    serializeTransitTravelTimeMatrixCheckpoint(checkpoint),
  );
  return checkpoint;
}

async function appendCompletedRows(
  path: string,
  bytes: Uint8Array,
  expectedOffset: number,
): Promise<void> {
  const currentSize = await regularFileSize(path);
  if (currentSize !== expectedOffset) {
    throw new Error(
      `Partial transit matrix has ${currentSize ?? 'no'} bytes; expected ${expectedOffset}.`,
    );
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
        throw new Error('Transit partial-matrix append made no progress.');
      }
      written += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const actualSize = await regularFileSize(path);
  if (actualSize !== expectedOffset + bytes.byteLength) {
    throw new Error(
      `Partial transit matrix has ${actualSize ?? 'no'} bytes after append; expected ${expectedOffset + bytes.byteLength}.`,
    );
  }
}

function deterministicIndexes(length: number, requestedCount: number): number[] {
  const count = Math.min(length, requestedCount);
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [0];
  }
  return Array.from({ length: count }, (_, index) =>
    Math.floor((index * (length - 1)) / (count - 1)),
  );
}

function queryResultMap(
  localityIds: readonly LocalityId[],
  queryReachableLocalities: TransitReachabilityQuery,
  originIndex: number,
): ReadonlyMap<LocalityId, number> {
  const originLocalityId = localityIds[originIndex];
  if (originLocalityId === undefined) {
    throw new Error(`Missing transit matrix locality ${originIndex}.`);
  }
  const values = new Map<LocalityId, number>();
  for (const result of queryReachableLocalities(
    originLocalityId,
    MAX_TRAVEL_MINUTES,
  )) {
    values.set(result.localityId, result.travelMinutes);
  }
  values.set(originLocalityId, 0);
  return values;
}

function validationDestinationIndexes(
  originIndex: number,
  localityCount: number,
): readonly number[] {
  const targetCount = Math.min(
    VALIDATION_DESTINATIONS_PER_ORIGIN,
    localityCount - 1,
  );
  const indexes = new Set<number>();
  for (const offset of [
    1,
    17,
    Math.floor(localityCount / 3),
    Math.floor((localityCount * 2) / 3),
    localityCount - 1,
  ]) {
    const destinationIndex = (originIndex + offset) % localityCount;
    if (destinationIndex !== originIndex) {
      indexes.add(destinationIndex);
    }
  }
  for (let offset = 1; indexes.size < targetCount; offset += 1) {
    const destinationIndex = (originIndex + offset) % localityCount;
    if (destinationIndex !== originIndex) {
      indexes.add(destinationIndex);
    }
  }
  return [...indexes].slice(0, targetCount);
}

function validateIndependentSample(
  localityIds: readonly LocalityId[],
  queryReachableLocalities: TransitReachabilityQuery,
  matrixBytes: Uint8Array,
): TravelTimeMatrixValidation {
  const localityCount = localityIds.length;
  let sampleSize = 0;
  for (const originIndex of deterministicIndexes(
    localityCount,
    VALIDATION_ORIGIN_COUNT,
  )) {
    const expectedById = queryResultMap(
      localityIds,
      queryReachableLocalities,
      originIndex,
    );
    for (const destinationIndex of validationDestinationIndexes(
      originIndex,
      localityCount,
    )) {
      const destinationId = localityIds[destinationIndex] as LocalityId;
      const expected = expectedById.get(destinationId);
      const rawValue = matrixBytes[
        originIndex * localityCount + destinationIndex
      ] as number;
      const actual =
        rawValue === UNAVAILABLE_TRAVEL_TIME ? undefined : rawValue;
      if (actual !== expected) {
        throw new Error(
          `Independent RAPTOR validation mismatch for ${localityIds[originIndex]} → ${destinationId}: matrix ${actual ?? 'unavailable'}, query ${expected ?? 'unavailable'}.`,
        );
      }
      sampleSize += 1;
    }
  }
  return { sampleSize, exactMatches: sampleSize };
}

async function finalizeMatrix(
  paths: MatrixWorkPaths,
  localityIds: readonly LocalityId[],
  source: PublicTransportArtifactSource,
  queryReachableLocalities: TransitReachabilityQuery,
): Promise<CalculateTravelTimesResult> {
  const matrixBytes = await readFile(paths.partialMatrixPath);
  const expectedByteLength = matrixByteLength(localityIds.length);
  if (matrixBytes.byteLength !== expectedByteLength) {
    throw new Error(
      `Completed public-transport matrix has ${matrixBytes.byteLength} bytes; expected ${expectedByteLength}.`,
    );
  }
  const validation = validateIndependentSample(
    localityIds,
    queryReachableLocalities,
    matrixBytes,
  );
  const published = await publishMatrixArtifact(
    matrixBytes,
    source,
    paths,
  );
  await Promise.all([
    unlink(paths.checkpointPath),
    unlink(paths.partialMatrixPath),
  ]);
  await rmdir(paths.workDirectory);
  return { ...published, validation };
}

/** Calculates, validates, and atomically publishes the full locality matrix. */
export async function calculateTravelTimes(
  options: CalculateTravelTimesOptions,
): Promise<CalculateTravelTimesResult> {
  const paths = resolvePaths(options.paths);
  const source = createManifestSource(options);
  const localityIds = options.localityRoutingIndex.entries.map(
    ({ localityId }) => localityId,
  );
  const queryReachableLocalities = createQuery(options);
  const rowGenerator = createTransitTravelTimeMatrixRowGenerator(
    localityIds,
    queryReachableLocalities,
  );
  const identity = resumeIdentity(localityIds.length, options);
  let checkpoint = await initializeOrResume(
    paths,
    identity,
    options.restart ?? false,
  );

  while (checkpoint.nextOriginIndex < localityIds.length) {
    const originStart = checkpoint.nextOriginIndex;
    const originEnd = Math.min(
      originStart + CHECKPOINT_ORIGIN_BLOCK_SIZE,
      localityIds.length,
    );
    const completedRows = new Uint8Array(
      (originEnd - originStart) * localityIds.length,
    );
    for (let originIndex = originStart; originIndex < originEnd; originIndex += 1) {
      completedRows.set(
        rowGenerator.generateRow(originIndex),
        (originIndex - originStart) * localityIds.length,
      );
    }
    await appendCompletedRows(
      paths.partialMatrixPath,
      completedRows,
      originStart * localityIds.length,
    );
    checkpoint = createTransitTravelTimeMatrixCheckpoint(identity, originEnd);
    await writeUtf8Atomically(
      paths.checkpointPath,
      serializeTransitTravelTimeMatrixCheckpoint(checkpoint),
    );
    await options.onProgress?.({
      completedOrigins: originEnd,
      totalOrigins: localityIds.length,
    });
  }

  return await finalizeMatrix(
    paths,
    localityIds,
    source,
    queryReachableLocalities,
  );
}
