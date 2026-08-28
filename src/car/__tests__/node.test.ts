import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getCarTravelMinutes } from '../index';
import { loadCarTravelTimeIndex } from '../node';

const MATRIX_BYTES = Uint8Array.from([0, 93, 95, 0]);
const MATRIX_SHA256 =
  '442f85dc01a0eb52fb36e9e29461d2ae48bd16d342bafa68e6f54b913f8f8715';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function manifestJson(matrixSha256 = MATRIX_SHA256): string {
  return JSON.stringify({
    mode: 'CAR',
    matrix: {
      schemaVersion: 1,
      localityCount: 2,
      localityIds: ['3011:bern', '8001:zurich'],
      maxTravelMinutes: 240,
      layout: 'ROW_MAJOR',
      valueEncoding: 'UINT8',
      unit: 'MINUTES',
      unavailableValue: 255,
      matrixByteLength: MATRIX_BYTES.byteLength,
      matrixSha256,
    },
    source: {
      sourceMatrixSha256: SHA_A,
      anchorsSha256: SHA_A,
      localityInputSha256: SHA_B,
      roadGraph: {
        sourcePbfSha256: SHA_A,
        osrmVersion: '26.8.0',
        profile: 'car.lua',
        algorithm: 'ch',
      },
    },
  });
}

const temporaryDirectories: string[] = [];

async function createFixture(
  matrixBytes: Uint8Array = MATRIX_BYTES,
): Promise<{ readonly runtimeDataDirectory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'jm-commute-car-node-'));
  temporaryDirectories.push(directory);
  const manifestPath = join(directory, 'manifest.json');
  const matrixPath = join(directory, 'travel-times.bin');
  await Promise.all([
    writeFile(manifestPath, manifestJson()),
    writeFile(matrixPath, matrixBytes),
  ]);
  return { runtimeDataDirectory: directory };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('loadCarTravelTimeIndex', () => {
  it('authenticates generated files and constructs the public runtime index', async () => {
    const paths = await createFixture();

    const index = await loadCarTravelTimeIndex(paths);

    expect(getCarTravelMinutes(index, '3011:bern', '8001:zurich')).toBe(93);
    expect(getCarTravelMinutes(index, '8001:zurich', '3011:bern')).toBe(95);
  });

  it('rejects matrix bytes whose SHA-256 does not match the manifest', async () => {
    const changedBytes = Uint8Array.from(MATRIX_BYTES);
    changedBytes[1] = 94;
    const paths = await createFixture(changedBytes);

    await expect(loadCarTravelTimeIndex(paths)).rejects.toThrow(
      `manifest expects ${MATRIX_SHA256}`,
    );
  });

  it('rejects a matrix with the wrong byte length before construction', async () => {
    const paths = await createFixture(MATRIX_BYTES.subarray(0, 3));

    await expect(loadCarTravelTimeIndex(paths)).rejects.toThrow(
      'has 3 bytes; manifest expects 4',
    );
  });

  it('reports manifest and matrix read failures with their paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jm-commute-car-node-'));
    temporaryDirectories.push(directory);
    const manifestPath = join(directory, 'manifest.json');
    const matrixPath = join(directory, 'travel-times.bin');

    await expect(
      loadCarTravelTimeIndex({ runtimeDataDirectory: directory }),
    ).rejects.toThrow(`manifest at "${manifestPath}"`);

    await writeFile(manifestPath, manifestJson());
    await expect(
      loadCarTravelTimeIndex({ runtimeDataDirectory: directory }),
    ).rejects.toThrow(`matrix at "${matrixPath}"`);
  });
});
