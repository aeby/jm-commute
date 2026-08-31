import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { createCarTravelTimeIndex } from '@jm/commute';
import {
  parseCarTravelTimeManifest,
  parseCarTravelTimeManifestJson,
  type CarTravelTimeManifest,
} from '@commute-internal/car/travel-time-manifest';
import {
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
  UNAVAILABLE_TRAVEL_TIME,
} from '@commute-internal/travel-time-matrix';

import type { RoadNetwork } from '../network';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const UTF8_ENCODER = new TextEncoder();

export interface RoadMatrixPublicationPaths {
  readonly manifestPath: string;
  readonly matrixPath: string;
}

export interface AuthenticatedRoadMatrixData {
  readonly manifest: CarTravelTimeManifest;
  readonly manifestByteLength: number;
  readonly manifestSha256: string;
  readonly matrixByteLength: number;
  readonly matrixSha256: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createRoadTravelTimeManifest(
  network: RoadNetwork,
  matrixBytes: Uint8Array,
): CarTravelTimeManifest {
  const localityIds = network.localities.map(({ localityId }) => localityId);
  return parseCarTravelTimeManifest(
    {
      mode: 'CAR',
      matrix: {
        schemaVersion: TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
        localityCount: localityIds.length,
        localityIds,
        maxTravelMinutes: COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
        layout: 'ROW_MAJOR',
        valueEncoding: 'UINT8',
        unit: 'MINUTES',
        unavailableValue: UNAVAILABLE_TRAVEL_TIME,
        matrixByteLength: matrixBytes.byteLength,
        matrixSha256: sha256(matrixBytes),
      },
      source: {
        anchorsSha256: network.anchorsSha256,
        localityInputSha256: network.localityInputSha256,
        roadGraph: network.roadGraph,
      },
    },
    'generated road travel-time manifest',
  );
}

export function serializeRoadTravelTimeManifest(
  manifest: CarTravelTimeManifest,
): Uint8Array {
  return UTF8_ENCODER.encode(
    `${JSON.stringify(parseCarTravelTimeManifest(manifest), null, 2)}\n`,
  );
}

export function authenticateRoadMatrixData(
  manifestBytes: Uint8Array,
  matrixBytes: Uint8Array,
  source = 'road matrix data',
): AuthenticatedRoadMatrixData {
  let manifestJson: string;
  try {
    manifestJson = UTF8_DECODER.decode(manifestBytes);
  } catch (error) {
    throw new Error(`${source} manifest is not valid UTF-8.`, { cause: error });
  }
  const manifest = parseCarTravelTimeManifestJson(
    manifestJson,
    `${source} manifest`,
  );
  if (matrixBytes.byteLength !== manifest.matrix.matrixByteLength) {
    throw new Error(
      `${source} matrix has ${matrixBytes.byteLength} bytes; expected ${manifest.matrix.matrixByteLength}.`,
    );
  }
  const matrixSha256 = sha256(matrixBytes);
  if (matrixSha256 !== manifest.matrix.matrixSha256) {
    throw new Error(`${source} matrix SHA-256 does not match its manifest.`);
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

async function writeSyncedFile(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Publishes the matrix first and its authenticated manifest last. */
export async function publishRoadMatrixArtifacts(
  manifestBytes: Uint8Array,
  matrixBytes: Uint8Array,
  paths: RoadMatrixPublicationPaths,
): Promise<AuthenticatedRoadMatrixData> {
  authenticateRoadMatrixData(
    manifestBytes,
    matrixBytes,
    'completed road matrix',
  );
  const outputDirectory = dirname(resolve(paths.manifestPath));
  if (resolve(paths.manifestPath) === resolve(paths.matrixPath)) {
    throw new Error('Road matrix manifest and binary paths must differ.');
  }
  if (outputDirectory !== dirname(resolve(paths.matrixPath))) {
    throw new Error('Road matrix manifest and binary must share a directory.');
  }
  await mkdir(outputDirectory, { recursive: true });
  const publicationId = `${process.pid}.${randomUUID()}`;
  const stagedManifestPath = resolve(
    outputDirectory,
    `.${basename(paths.manifestPath)}.${publicationId}.staged`,
  );
  const stagedMatrixPath = resolve(
    outputDirectory,
    `.${basename(paths.matrixPath)}.${publicationId}.staged`,
  );
  try {
    await writeSyncedFile(stagedMatrixPath, matrixBytes);
    await writeSyncedFile(stagedManifestPath, manifestBytes);
    authenticateRoadMatrixData(
      await readFile(stagedManifestPath),
      await readFile(stagedMatrixPath),
      'staged road matrix',
    );
    await rename(stagedMatrixPath, paths.matrixPath);
    await rename(stagedManifestPath, paths.manifestPath);
    return authenticateRoadMatrixData(
      await readFile(paths.manifestPath),
      await readFile(paths.matrixPath),
      'published road matrix',
    );
  } finally {
    await Promise.all([
      unlink(stagedManifestPath).catch(() => undefined),
      unlink(stagedMatrixPath).catch(() => undefined),
    ]);
  }
}
