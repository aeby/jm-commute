import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createCarTravelTimeIndex } from '@core/car';
import {
  parseCarTravelTimeManifest,
  parseCarTravelTimeManifestJson,
  type CarTravelTimeManifest,
} from '@core/car/travel-time-manifest';
import {
  parseCarTravelTimeMatrixManifestJson,
  TRAVEL_TIME_MATRIX_BYTES_PER_CELL as SOURCE_BYTES_PER_CELL,
  UNREACHABLE_TRAVEL_MINUTES as SOURCE_UNAVAILABLE_VALUE,
  type CarTravelTimeMatrixManifest as SourceCarTravelTimeMatrixManifest,
} from '@core/car/preprocessing/travel-time-matrix-format';
import {
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
  UNAVAILABLE_TRAVEL_TIME,
} from '@core/travel-time-matrix';

export interface RuntimeCarDataPaths {
  readonly sourceManifestPath: string;
  readonly sourceMatrixPath: string;
  readonly outputManifestPath: string;
  readonly outputMatrixPath: string;
}

export interface RuntimeCarDataArtifactSummary {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface RuntimeCarMatrixConversionStatistics {
  readonly totalCells: number;
  readonly retainedCells: number;
  readonly cappedAboveHorizonCells: number;
  readonly sourceUnavailableCells: number;
  readonly unavailableCells: number;
}

export interface RuntimeCarDataPublicationTimings {
  readonly sourceReadConversionAndValidationMilliseconds: number;
  readonly stagingAndValidationMilliseconds: number;
  readonly promotionAndReadbackMilliseconds: number;
  readonly totalMilliseconds: number;
}

export interface RuntimeCarDataPublicationResult {
  readonly localityCount: number;
  readonly sourceManifest: RuntimeCarDataArtifactSummary;
  readonly sourceMatrix: RuntimeCarDataArtifactSummary;
  readonly manifest: RuntimeCarDataArtifactSummary;
  readonly matrix: RuntimeCarDataArtifactSummary;
  readonly statistics: RuntimeCarMatrixConversionStatistics;
  readonly timings: RuntimeCarDataPublicationTimings;
}

export interface AuthenticatedSourceCarData {
  readonly manifest: SourceCarTravelTimeMatrixManifest;
  readonly manifestByteLength: number;
  readonly manifestSha256: string;
  readonly matrixByteLength: number;
  readonly matrixSha256: string;
}

export interface AuthenticatedRuntimeCarData {
  readonly manifest: CarTravelTimeManifest;
  readonly manifestByteLength: number;
  readonly manifestSha256: string;
  readonly matrixByteLength: number;
  readonly matrixSha256: string;
}

export interface ConvertedRuntimeCarData {
  readonly manifest: CarTravelTimeManifest;
  readonly manifestBytes: Uint8Array;
  readonly matrixBytes: Uint8Array;
  readonly source: AuthenticatedSourceCarData;
  readonly statistics: RuntimeCarMatrixConversionStatistics;
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const UTF8_ENCODER = new TextEncoder();

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeManifest(manifestBytes: Uint8Array, source: string): string {
  try {
    return UTF8_DECODER.decode(manifestBytes);
  } catch (error) {
    throw new Error(`${source} manifest is not valid UTF-8.`, { cause: error });
  }
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function assertExactBytes(
  expected: Uint8Array,
  actual: Uint8Array,
  description: string,
): void {
  if (!asBuffer(expected).equals(asBuffer(actual))) {
    throw new Error(`${description} bytes changed during publication.`);
  }
}

export function authenticateSourceCarData(
  manifestBytes: Uint8Array,
  matrixBytes: Uint8Array,
  source = 'source car data',
): AuthenticatedSourceCarData {
  const manifest = parseCarTravelTimeMatrixManifestJson(
    decodeManifest(manifestBytes, source),
    `${source} manifest`,
  );
  if (matrixBytes.byteLength !== manifest.matrixByteLength) {
    throw new Error(
      `${source} matrix has ${matrixBytes.byteLength} bytes; ` +
        `manifest expects ${manifest.matrixByteLength}.`,
    );
  }
  const matrixSha256 = sha256(matrixBytes);
  if (matrixSha256 !== manifest.matrixSha256) {
    throw new Error(
      `${source} matrix has SHA-256 ${matrixSha256}; manifest expects ${manifest.matrixSha256}.`,
    );
  }
  return {
    manifest,
    manifestByteLength: manifestBytes.byteLength,
    manifestSha256: sha256(manifestBytes),
    matrixByteLength: matrixBytes.byteLength,
    matrixSha256,
  };
}

export function authenticateRuntimeCarData(
  manifestBytes: Uint8Array,
  matrixBytes: Uint8Array,
  source = 'runtime car data',
): AuthenticatedRuntimeCarData {
  const manifest = parseCarTravelTimeManifestJson(
    decodeManifest(manifestBytes, source),
    `${source} manifest`,
  );
  if (matrixBytes.byteLength !== manifest.matrix.matrixByteLength) {
    throw new Error(
      `${source} matrix has ${matrixBytes.byteLength} bytes; ` +
        `manifest expects ${manifest.matrix.matrixByteLength}.`,
    );
  }
  const matrixSha256 = sha256(matrixBytes);
  if (matrixSha256 !== manifest.matrix.matrixSha256) {
    throw new Error(
      `${source} matrix has SHA-256 ${matrixSha256}; ` +
        `manifest expects ${manifest.matrix.matrixSha256}.`,
    );
  }
  createCarTravelTimeIndex(manifest, matrixBytes);
  return {
    manifest,
    manifestByteLength: manifestBytes.byteLength,
    manifestSha256: sha256(manifestBytes),
    matrixByteLength: matrixBytes.byteLength,
    matrixSha256,
  };
}

function sourceValueAt(matrixBytes: Uint8Array, cellIndex: number): number {
  const byteIndex = cellIndex * SOURCE_BYTES_PER_CELL;
  return (
    (matrixBytes[byteIndex] as number) |
    ((matrixBytes[byteIndex + 1] as number) << 8)
  );
}

/** Converts an authenticated full UInt16 preprocessing matrix to UInt8 runtime data. */
export function convertCarTravelTimeMatrixToRuntime(
  sourceManifestBytes: Uint8Array,
  sourceMatrixBytes: Uint8Array,
  source = 'source car data',
): ConvertedRuntimeCarData {
  const authenticatedSource = authenticateSourceCarData(
    sourceManifestBytes,
    sourceMatrixBytes,
    source,
  );
  const sourceManifest = authenticatedSource.manifest;
  const cellCount = sourceManifest.localityCount * sourceManifest.localityCount;
  const runtimeMatrixBytes = new Uint8Array(cellCount);

  let retainedCells = 0;
  let cappedAboveHorizonCells = 0;
  let sourceUnavailableCells = 0;

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const sourceValue = sourceValueAt(sourceMatrixBytes, cellIndex);
    let runtimeValue: number;
    if (sourceValue === SOURCE_UNAVAILABLE_VALUE) {
      runtimeValue = UNAVAILABLE_TRAVEL_TIME;
      sourceUnavailableCells += 1;
    } else if (sourceValue > COMMUTE_MATRIX_MAX_TRAVEL_MINUTES) {
      runtimeValue = UNAVAILABLE_TRAVEL_TIME;
      cappedAboveHorizonCells += 1;
    } else {
      runtimeValue = sourceValue;
      retainedCells += 1;
    }
    runtimeMatrixBytes[cellIndex] = runtimeValue;
  }

  for (let localityIndex = 0; localityIndex < sourceManifest.localityCount; localityIndex += 1) {
    const diagonalCellIndex =
      localityIndex * sourceManifest.localityCount + localityIndex;
    const sourceValue = sourceValueAt(sourceMatrixBytes, diagonalCellIndex);
    const runtimeValue = runtimeMatrixBytes[diagonalCellIndex] as number;
    if (sourceValue !== 0 || runtimeValue !== 0) {
      throw new Error(
        `Car travel-time matrix self cell for ` +
          `"${sourceManifest.localityIds[localityIndex]}" must remain 0; ` +
          `source is ${sourceValue} and runtime is ${runtimeValue}.`,
      );
    }
  }

  const matrixSha256 = sha256(runtimeMatrixBytes);
  const manifest = parseCarTravelTimeManifest(
    {
      mode: 'CAR',
      matrix: {
        schemaVersion: TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
        localityCount: sourceManifest.localityCount,
        localityIds: sourceManifest.localityIds,
        maxTravelMinutes: COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
        layout: 'ROW_MAJOR',
        valueEncoding: 'UINT8',
        unit: 'MINUTES',
        unavailableValue: UNAVAILABLE_TRAVEL_TIME,
        matrixByteLength: runtimeMatrixBytes.byteLength,
        matrixSha256,
      },
      source: {
        sourceMatrixSha256: authenticatedSource.matrixSha256,
        anchorsSha256: sourceManifest.anchorsSha256,
        localityInputSha256: sourceManifest.localityInputSha256,
        roadGraph: sourceManifest.roadGraph,
      },
    },
    'converted runtime car manifest',
  );
  const manifestBytes = UTF8_ENCODER.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  authenticateRuntimeCarData(
    manifestBytes,
    runtimeMatrixBytes,
    'converted runtime car data',
  );

  return {
    manifest,
    manifestBytes,
    matrixBytes: runtimeMatrixBytes,
    source: authenticatedSource,
    statistics: {
      totalCells: cellCount,
      retainedCells,
      cappedAboveHorizonCells,
      sourceUnavailableCells,
      unavailableCells: cappedAboveHorizonCells + sourceUnavailableCells,
    },
  };
}

async function readArtifact(path: string, description: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`Unable to read ${description} at "${path}".`, { cause: error });
  }
}

async function writeStagedFile(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertDistinctPaths(paths: RuntimeCarDataPaths): void {
  const entries = [
    ['source manifest', paths.sourceManifestPath],
    ['source matrix', paths.sourceMatrixPath],
    ['output manifest', paths.outputManifestPath],
    ['output matrix', paths.outputMatrixPath],
  ] as const;
  const labelsByPath = new Map<string, string>();
  for (const [label, path] of entries) {
    const absolutePath = resolve(path);
    const existingLabel = labelsByPath.get(absolutePath);
    if (existingLabel !== undefined) {
      throw new Error(
        `Runtime car-data paths overlap: ${existingLabel} and ${label} ` +
          `both resolve to "${absolutePath}".`,
      );
    }
    labelsByPath.set(absolutePath, label);
  }
}

function stagingPath(outputPath: string, publicationId: string): string {
  return resolve(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${publicationId}.staged`,
  );
}

async function authenticateReadback(
  manifestPath: string,
  matrixPath: string,
  expectedManifestBytes: Uint8Array,
  expectedMatrixBytes: Uint8Array,
  source: string,
): Promise<AuthenticatedRuntimeCarData> {
  const [manifestBytes, matrixBytes] = await Promise.all([
    readArtifact(manifestPath, `${source} manifest`),
    readArtifact(matrixPath, `${source} matrix`),
  ]);
  const authenticated = authenticateRuntimeCarData(manifestBytes, matrixBytes, source);
  assertExactBytes(expectedManifestBytes, manifestBytes, `${source} manifest`);
  assertExactBytes(expectedMatrixBytes, matrixBytes, `${source} matrix`);
  return authenticated;
}

/**
 * Converts, stages, authenticates, and publishes deterministic runtime car
 * artifacts. The matrix is promoted first and the manifest last as the commit
 * marker, so an interrupted fixed-name promotion fails closed at load-time SHA
 * authentication rather than being accepted as a valid pair.
 */
export async function publishRuntimeCarData(
  paths: RuntimeCarDataPaths,
): Promise<RuntimeCarDataPublicationResult> {
  assertDistinctPaths(paths);
  const startedAt = performance.now();
  const [sourceManifestBytes, sourceMatrixBytes] = await Promise.all([
    readArtifact(paths.sourceManifestPath, 'source car matrix manifest'),
    readArtifact(paths.sourceMatrixPath, 'source car matrix'),
  ]);
  const converted = convertCarTravelTimeMatrixToRuntime(
    sourceManifestBytes,
    sourceMatrixBytes,
  );
  const sourceConvertedAt = performance.now();

  await Promise.all([
    mkdir(dirname(paths.outputManifestPath), { recursive: true }),
    mkdir(dirname(paths.outputMatrixPath), { recursive: true }),
  ]);
  const publicationId = randomUUID();
  const stagedManifestPath = stagingPath(paths.outputManifestPath, publicationId);
  const stagedMatrixPath = stagingPath(paths.outputMatrixPath, publicationId);

  try {
    await writeStagedFile(stagedMatrixPath, converted.matrixBytes);
    await writeStagedFile(stagedManifestPath, converted.manifestBytes);
    await authenticateReadback(
      stagedManifestPath,
      stagedMatrixPath,
      converted.manifestBytes,
      converted.matrixBytes,
      'staged runtime car data',
    );
    const stagedAt = performance.now();

    await rename(stagedMatrixPath, paths.outputMatrixPath);
    await rename(stagedManifestPath, paths.outputManifestPath);
    const published = await authenticateReadback(
      paths.outputManifestPath,
      paths.outputMatrixPath,
      converted.manifestBytes,
      converted.matrixBytes,
      'published runtime car data',
    );
    const [unchangedSourceManifest, unchangedSourceMatrix] = await Promise.all([
      readArtifact(paths.sourceManifestPath, 'source car matrix manifest readback'),
      readArtifact(paths.sourceMatrixPath, 'source car matrix readback'),
    ]);
    assertExactBytes(sourceManifestBytes, unchangedSourceManifest, 'source manifest');
    assertExactBytes(sourceMatrixBytes, unchangedSourceMatrix, 'source matrix');
    const completedAt = performance.now();

    return {
      localityCount: published.manifest.matrix.localityCount,
      sourceManifest: {
        path: paths.sourceManifestPath,
        byteLength: converted.source.manifestByteLength,
        sha256: converted.source.manifestSha256,
      },
      sourceMatrix: {
        path: paths.sourceMatrixPath,
        byteLength: converted.source.matrixByteLength,
        sha256: converted.source.matrixSha256,
      },
      manifest: {
        path: paths.outputManifestPath,
        byteLength: published.manifestByteLength,
        sha256: published.manifestSha256,
      },
      matrix: {
        path: paths.outputMatrixPath,
        byteLength: published.matrixByteLength,
        sha256: published.matrixSha256,
      },
      statistics: converted.statistics,
      timings: {
        sourceReadConversionAndValidationMilliseconds:
          sourceConvertedAt - startedAt,
        stagingAndValidationMilliseconds: stagedAt - sourceConvertedAt,
        promotionAndReadbackMilliseconds: completedAt - stagedAt,
        totalMilliseconds: completedAt - startedAt,
      },
    };
  } finally {
    await Promise.all([
      unlink(stagedManifestPath).catch(() => undefined),
      unlink(stagedMatrixPath).catch(() => undefined),
    ]);
  }
}
