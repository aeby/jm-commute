import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { TravelTimeMatrixDescriptor } from '@commute-internal/travel-time-matrix';
import type { TransitTravelTimeSource } from '@commute-internal/transit/travel-time-manifest';

import {
  authenticateTransitMatrixData,
  createTransitTravelTimeManifest,
  publishTransitMatrixArtifacts,
  serializeTransitTravelTimeManifest,
} from '../artifacts';

const matrixBytes = Uint8Array.of(0, 30, 40, 0);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function descriptor(): TravelTimeMatrixDescriptor {
  return {
    schemaVersion: 1,
    localityCount: 2,
    localityIds: ['A', 'B'],
    maxTravelMinutes: 240,
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT8',
    unit: 'MINUTES',
    unavailableValue: 255,
    matrixByteLength: 4,
    matrixSha256: 'a'.repeat(64),
  };
}

const source: TransitTravelTimeSource = {
  serviceDate: '2026-09-07',
  morningWindow: { start: '07:00:00', end: '09:00:00' },
  gtfsFeedVersion: 'fixture',
  routingDataFingerprint: 'b'.repeat(64),
  timetableFingerprint: 'c'.repeat(64),
  localityRoutingIndexSha256: 'd'.repeat(64),
  routingPolicy: {
    maxTransfers: 5,
    minTransferTimeSeconds: 120,
    virtualTransfersEnabled: false,
  },
};

describe('transit matrix artifacts', () => {
  it('creates deterministic shared descriptors and authenticates bytes', () => {
    const manifest = createTransitTravelTimeManifest(
      descriptor().localityIds,
      matrixBytes,
      source,
    );
    const first = serializeTransitTravelTimeManifest(manifest);
    const second = serializeTransitTravelTimeManifest(manifest);
    expect(second).toEqual(first);

    const authenticated = authenticateTransitMatrixData(first, matrixBytes);
    expect(authenticated.manifest).toEqual(manifest);
    expect(authenticated.matrixByteLength).toBe(4);
  });

  it('rejects binary corruption and reserved values', () => {
    const manifest = createTransitTravelTimeManifest(
      descriptor().localityIds,
      matrixBytes,
      source,
    );
    const manifestBytes = serializeTransitTravelTimeManifest(manifest);
    const corrupted = Uint8Array.from(matrixBytes);
    corrupted[1] = 31;
    expect(() => authenticateTransitMatrixData(manifestBytes, corrupted)).toThrow(
      'manifest expects',
    );

    const reserved = Uint8Array.from(matrixBytes);
    reserved[1] = 241;
    const reservedManifest = serializeTransitTravelTimeManifest(
      createTransitTravelTimeManifest(
        descriptor().localityIds,
        reserved,
        source,
      ),
    );
    expect(() => authenticateTransitMatrixData(reservedManifest, reserved)).toThrow(
      'reserved schema-v1 value 241',
    );
  });

  it('stages and deterministically promotes the final runtime pair', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'jm-commute-transit-matrix-publication-'),
    );
    temporaryDirectories.push(directory);
    const paths = {
      manifestPath: join(directory, 'manifest.json'),
      matrixPath: join(directory, 'travel-times.bin'),
    };
    const manifestBytes = serializeTransitTravelTimeManifest(
      createTransitTravelTimeManifest(
        descriptor().localityIds,
        matrixBytes,
        source,
      ),
    );

    const first = await publishTransitMatrixArtifacts(
      manifestBytes,
      matrixBytes,
      paths,
    );
    const firstManifest = await readFile(paths.manifestPath);
    const firstMatrix = await readFile(paths.matrixPath);
    const second = await publishTransitMatrixArtifacts(
      manifestBytes,
      matrixBytes,
      paths,
    );

    expect(await readFile(paths.manifestPath)).toEqual(firstManifest);
    expect(await readFile(paths.matrixPath)).toEqual(firstMatrix);
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect(second.matrixSha256).toBe(first.matrixSha256);
    expect((await readdir(directory)).toSorted()).toEqual([
      'manifest.json',
      'travel-times.bin',
    ]);
  });
});
