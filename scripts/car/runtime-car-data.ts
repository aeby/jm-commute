import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createCarTravelTimeIndex } from '../../src/car';
import {
  parseCarTravelTimeMatrixManifestJson,
  type CarTravelTimeMatrixManifest,
} from '../../src/car/travel-time-matrix-format';

export interface RuntimeCarDataPaths {
  readonly sourceManifestPath: string;
  readonly sourceMatrixPath: string;
  readonly outputManifestPath: string;
  readonly outputMatrixPath: string;
}

export interface RuntimeCarDataArtifactSummary {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface RuntimeCarDataPublicationTimings {
  readonly sourceReadAndValidationMilliseconds: number;
  readonly stagingAndValidationMilliseconds: number;
  readonly promotionAndReadbackMilliseconds: number;
  readonly totalMilliseconds: number;
}

export interface RuntimeCarDataPublicationResult {
  readonly localityCount: number;
  readonly manifest: RuntimeCarDataArtifactSummary;
  readonly matrix: RuntimeCarDataArtifactSummary;
  readonly timings: RuntimeCarDataPublicationTimings;
}

export interface AuthenticatedRuntimeCarData {
  /** The strict parsed structure, including all matrix provenance fields. */
  readonly manifest: CarTravelTimeMatrixManifest;
  readonly manifestByteLength: number;
  readonly manifestSha256: string;
  readonly matrixByteLength: number;
  readonly matrixSha256: string;
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeManifest(
  manifestBytes: Uint8Array,
  source: string,
): string {
  try {
    return UTF8_DECODER.decode(manifestBytes);
  } catch (error) {
    throw new Error(`${source} manifest is not valid UTF-8.`, { cause: error });
  }
}

/**
 * Strictly parses the manifest and authenticates the corresponding matrix.
 * This function never normalizes or reserializes either input byte sequence.
 */
export function authenticateRuntimeCarData(
  manifestBytes: Uint8Array,
  matrixBytes: Uint8Array,
  source = 'runtime car data',
): AuthenticatedRuntimeCarData {
  const manifest = parseCarTravelTimeMatrixManifestJson(
    decodeManifest(manifestBytes, source),
    `${source} manifest`,
  );

  if (matrixBytes.byteLength !== manifest.matrixByteLength) {
    throw new Error(
      `${source} matrix has ${matrixBytes.byteLength} bytes; manifest expects ${manifest.matrixByteLength}.`,
    );
  }

  const matrixSha256 = sha256(matrixBytes);
  if (matrixSha256 !== manifest.matrixSha256) {
    throw new Error(
      `${source} matrix has SHA-256 ${matrixSha256}; manifest expects ${manifest.matrixSha256}.`,
    );
  }

  // Validate the binary's runtime semantics too, including its dimensions and
  // the required zero value for every self-to-self diagonal cell.
  createCarTravelTimeIndex(manifest, matrixBytes);

  return {
    manifest,
    manifestByteLength: manifestBytes.byteLength,
    manifestSha256: sha256(manifestBytes),
    matrixByteLength: matrixBytes.byteLength,
    matrixSha256,
  };
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

async function readArtifact(path: string, description: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`Unable to read ${description} at "${path}".`, {
      cause: error,
    });
  }
}

async function writeStagedFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
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
        `Runtime car-data paths overlap: ${existingLabel} and ${label} both resolve to "${absolutePath}".`,
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
  const authenticated = authenticateRuntimeCarData(
    manifestBytes,
    matrixBytes,
    source,
  );
  assertExactBytes(
    expectedManifestBytes,
    manifestBytes,
    `${source} manifest`,
  );
  assertExactBytes(expectedMatrixBytes, matrixBytes, `${source} matrix`);
  return authenticated;
}

/**
 * Publishes authenticated runtime artifacts without changing their bytes.
 * Both files are staged and validated first. The matrix is atomically promoted
 * before the manifest, so the manifest is always the publication commit point.
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
  authenticateRuntimeCarData(
    sourceManifestBytes,
    sourceMatrixBytes,
    'source car data',
  );
  const sourceValidatedAt = performance.now();

  await Promise.all([
    mkdir(dirname(paths.outputManifestPath), { recursive: true }),
    mkdir(dirname(paths.outputMatrixPath), { recursive: true }),
  ]);

  const publicationId = randomUUID();
  const stagedManifestPath = stagingPath(
    paths.outputManifestPath,
    publicationId,
  );
  const stagedMatrixPath = stagingPath(paths.outputMatrixPath, publicationId);

  try {
    // Wait for each staged write to finish before validation or cleanup can
    // begin; this also avoids leaving a late concurrent write behind on error.
    await writeStagedFile(stagedMatrixPath, sourceMatrixBytes);
    await writeStagedFile(stagedManifestPath, sourceManifestBytes);
    await authenticateReadback(
      stagedManifestPath,
      stagedMatrixPath,
      sourceManifestBytes,
      sourceMatrixBytes,
      'staged runtime car data',
    );
    const stagedAt = performance.now();

    // Each rename is atomic. The manifest is deliberately promoted last.
    await rename(stagedMatrixPath, paths.outputMatrixPath);
    await rename(stagedManifestPath, paths.outputManifestPath);

    const published = await authenticateReadback(
      paths.outputManifestPath,
      paths.outputMatrixPath,
      sourceManifestBytes,
      sourceMatrixBytes,
      'published runtime car data',
    );
    const completedAt = performance.now();

    return {
      localityCount: published.manifest.localityCount,
      manifest: {
        sourcePath: paths.sourceManifestPath,
        outputPath: paths.outputManifestPath,
        byteLength: published.manifestByteLength,
        sha256: published.manifestSha256,
      },
      matrix: {
        sourcePath: paths.sourceMatrixPath,
        outputPath: paths.outputMatrixPath,
        byteLength: published.matrixByteLength,
        sha256: published.matrixSha256,
      },
      timings: {
        sourceReadAndValidationMilliseconds:
          sourceValidatedAt - startedAt,
        stagingAndValidationMilliseconds: stagedAt - sourceValidatedAt,
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
