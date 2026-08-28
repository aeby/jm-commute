import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyPackageDataDirectories } from '../package-data';
import { generateRuntimeLocalityCatalog } from '../runtime-locality-catalog';
import { createTemporaryDirectory, removeTemporaryDirectories } from './temporary-directories';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const LOCALITY_IDS = ['1000:alpha', '2000:beta'] as const;
const LOCALITY_CSV = [
  'Ortschaftsname;PLZ4;E;N;Adressenanteil',
  'Alpha;1000;7.1;46.1;100',
  'Beta;2000;8.2;47.2;100',
  '',
].join('\n');

afterEach(removeTemporaryDirectories);

function matrixDescriptor(matrix: Uint8Array) {
  return {
    schemaVersion: 1,
    localityCount: LOCALITY_IDS.length,
    localityIds: LOCALITY_IDS,
    maxTravelMinutes: 240,
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT8',
    unit: 'MINUTES',
    unavailableValue: 255,
    matrixByteLength: matrix.byteLength,
    matrixSha256: createHash('sha256').update(matrix).digest('hex'),
  } as const;
}

function manifest(mode: 'car' | 'transit', matrix: Uint8Array) {
  const descriptor = matrixDescriptor(matrix);
  return mode === 'car'
    ? {
        mode: 'CAR',
        matrix: descriptor,
        source: {
          sourceMatrixSha256: SHA_A,
          anchorsSha256: SHA_B,
          localityInputSha256: SHA_A,
          roadGraph: {
            sourcePbfSha256: SHA_B,
            osrmVersion: '26.8.0',
            profile: 'car.lua',
            algorithm: 'ch',
          },
        },
      }
    : {
        mode: 'TRANSIT',
        matrix: descriptor,
        source: {
          serviceDate: '2025-02-04',
          morningWindow: { start: '07:00:00', end: '09:00:00' },
          gtfsFeedVersion: 'fixture',
          routingDataFingerprint: SHA_A,
          timetableFingerprint: SHA_B,
          localityRoutingIndexSha256: SHA_A,
          routingPolicy: {
            maxTransfers: 4,
            minTransferTimeSeconds: 120,
            virtualTransfersEnabled: true,
          },
        },
      };
}

async function writeDataDirectory(
  directory: string,
  carMatrix = Uint8Array.of(0, 10, 20, 0),
  localityIds: readonly string[] = LOCALITY_IDS,
): Promise<void> {
  await Promise.all([
    mkdir(resolve(directory, 'car'), { recursive: true }),
    mkdir(resolve(directory, 'transit'), { recursive: true }),
  ]);
  const transitMatrix = Uint8Array.of(0, 12, 18, 0);
  for (const [mode, matrix] of [
    ['car', carMatrix],
    ['transit', transitMatrix],
  ] as const) {
    await Promise.all([
      writeFile(
        resolve(directory, mode, 'manifest.json'),
        `${JSON.stringify(manifest(mode, matrix), null, 2)}\n`,
      ),
      writeFile(resolve(directory, mode, 'travel-times.bin'), matrix),
    ]);
  }
  const catalog = generateRuntimeLocalityCatalog(LOCALITY_CSV, localityIds);
  await writeFile(resolve(directory, 'localities.json'), catalog.serialized);
}

describe('package runtime-data identity verification', () => {
  it('accepts byte-identical authenticated source and package data', async () => {
    const root = await createTemporaryDirectory('package-data-valid');
    const source = resolve(root, 'source');
    const packaged = resolve(root, 'packaged');
    await Promise.all([writeDataDirectory(source), writeDataDirectory(packaged)]);

    const result = await verifyPackageDataDirectories(source, packaged);
    expect(result.localityCount).toBe(2);
    expect(result.localityCatalog.localityCount).toBe(2);
  });

  it('rejects a separately valid package matrix that differs from source', async () => {
    const root = await createTemporaryDirectory('package-data-matrix-mismatch');
    const source = resolve(root, 'source');
    const packaged = resolve(root, 'packaged');
    await Promise.all([
      writeDataDirectory(source),
      writeDataDirectory(packaged, Uint8Array.of(0, 11, 20, 0)),
    ]);

    await expect(
      verifyPackageDataDirectories(source, packaged),
    ).rejects.toThrow('not byte-identical');
  });

  it('rejects a catalog whose ordering differs from its matrices', async () => {
    const root = await createTemporaryDirectory('package-data-order-mismatch');
    const source = resolve(root, 'source');
    const packaged = resolve(root, 'packaged');
    await Promise.all([writeDataDirectory(source), writeDataDirectory(packaged)]);
    const reversed = generateRuntimeLocalityCatalog(
      LOCALITY_CSV,
      LOCALITY_IDS.toReversed(),
    );
    await writeFile(resolve(packaged, 'localities.json'), reversed.serialized);

    await expect(
      verifyPackageDataDirectories(source, packaged),
    ).rejects.toThrow('differs from matrix order');
  });
});

