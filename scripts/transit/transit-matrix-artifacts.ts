import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createTransitTravelTimeIndex } from '@jm/commute';
import {
  parseTransitTravelTimeManifest,
  parseTransitTravelTimeManifestJson,
  type TransitTravelTimeSource,
  type TransitTravelTimeManifest,
} from '@commute-internal/transit/travel-time-manifest';
import type { LocalityId } from '@jm/commute';
import {
  calculateTravelTimeMatrixByteLength,
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
  UNAVAILABLE_TRAVEL_TIME,
} from '@commute-internal/travel-time-matrix';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const UTF8_ENCODER = new TextEncoder();

export interface AuthenticatedTransitMatrixData {
  readonly manifest: TransitTravelTimeManifest;
  readonly manifestByteLength: number;
  readonly manifestSha256: string;
  readonly matrixByteLength: number;
  readonly matrixSha256: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeManifest(bytes: Uint8Array, source: string): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch (error) {
    throw new Error(`${source} manifest is not valid UTF-8.`, { cause: error });
  }
}

export function createTransitTravelTimeManifest(
  localityIds: readonly LocalityId[],
  matrixBytes: Uint8Array,
  source: TransitTravelTimeSource,
): TransitTravelTimeManifest {
  const localityCount = localityIds.length;
  return parseTransitTravelTimeManifest(
    {
      mode: 'TRANSIT',
      matrix: {
        schemaVersion: TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
        localityCount,
        localityIds,
        maxTravelMinutes: COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
        layout: 'ROW_MAJOR',
        valueEncoding: 'UINT8',
        unit: 'MINUTES',
        unavailableValue: UNAVAILABLE_TRAVEL_TIME,
        matrixByteLength: calculateTravelTimeMatrixByteLength(localityCount),
        matrixSha256: sha256(matrixBytes),
      },
      source,
    },
    'generated transit travel-time manifest',
  );
}

export interface TransitMatrixPublicationPaths {
  readonly manifestPath: string;
  readonly matrixPath: string;
}

async function writeSyncedFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const handle = await open(path, 'w');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Stages and authenticates a completed matrix in its runtime directory before
 * promoting the matrix first and the manifest last. Callers retain their
 * resumable source bytes until this function and final readback succeed.
 */
export async function publishTransitMatrixArtifacts(
  manifestBytes: Uint8Array,
  matrixBytes: Uint8Array,
  paths: TransitMatrixPublicationPaths,
): Promise<AuthenticatedTransitMatrixData> {
  authenticateTransitMatrixData(
    manifestBytes,
    matrixBytes,
    'completed transit matrix',
  );
  const outputDirectory = dirname(resolve(paths.manifestPath));
  if (outputDirectory !== dirname(resolve(paths.matrixPath))) {
    throw new Error('Transit runtime manifest and matrix must share a directory.');
  }
  await mkdir(outputDirectory, { recursive: true });
  const stagedManifestPath = resolve(outputDirectory, '.manifest.json.staged');
  const stagedMatrixPath = resolve(outputDirectory, '.travel-times.bin.staged');
  try {
    await writeSyncedFile(stagedMatrixPath, matrixBytes);
    await writeSyncedFile(stagedManifestPath, manifestBytes);
    const [stagedManifest, stagedMatrix] = await Promise.all([
      readFile(stagedManifestPath),
      readFile(stagedMatrixPath),
    ]);
    authenticateTransitMatrixData(
      stagedManifest,
      stagedMatrix,
      'staged transit runtime matrix',
    );

    await rename(stagedMatrixPath, paths.matrixPath);
    await rename(stagedManifestPath, paths.manifestPath);
    const [publishedManifest, publishedMatrix] = await Promise.all([
      readFile(paths.manifestPath),
      readFile(paths.matrixPath),
    ]);
    return authenticateTransitMatrixData(
      publishedManifest,
      publishedMatrix,
      'published transit runtime matrix',
    );
  } finally {
    await Promise.all([
      unlink(stagedManifestPath).catch(() => undefined),
      unlink(stagedMatrixPath).catch(() => undefined),
    ]);
  }
}

export function serializeTransitTravelTimeManifest(
  manifest: TransitTravelTimeManifest,
): Uint8Array {
  const validated = parseTransitTravelTimeManifest(
    manifest,
    'transit manifest serialization input',
  );
  return UTF8_ENCODER.encode(`${JSON.stringify(validated, null, 2)}\n`);
}

export function authenticateTransitMatrixData(
  manifestBytes: Uint8Array,
  matrixBytes: Uint8Array,
  source = 'transit matrix data',
): AuthenticatedTransitMatrixData {
  const manifest = parseTransitTravelTimeManifestJson(
    decodeManifest(manifestBytes, source),
    `${source} manifest`,
  );
  if (matrixBytes.byteLength !== manifest.matrix.matrixByteLength) {
    throw new Error(
      `${source} matrix has ${matrixBytes.byteLength} bytes; manifest expects ${manifest.matrix.matrixByteLength}.`,
    );
  }
  const matrixSha256 = sha256(matrixBytes);
  if (matrixSha256 !== manifest.matrix.matrixSha256) {
    throw new Error(
      `${source} matrix has SHA-256 ${matrixSha256}; manifest expects ${manifest.matrix.matrixSha256}.`,
    );
  }
  createTransitTravelTimeIndex(manifest, matrixBytes);
  return {
    manifest,
    manifestByteLength: manifestBytes.byteLength,
    manifestSha256: sha256(manifestBytes),
    matrixByteLength: matrixBytes.byteLength,
    matrixSha256,
  };
}
