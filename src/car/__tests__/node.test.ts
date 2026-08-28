import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getCarTravelMinutes } from '../index';
import {
  loadCarTravelTimeIndex,
  resolveCarRuntimeDataPaths,
} from '../node';

const MATRIX_BYTES = Uint8Array.from([0, 0, 93, 0, 95, 0, 0, 0]);
const MATRIX_SHA256 =
  'c2eceddcfe024b7d28005019dfd2c45dcc71b59b1a5394ec9844c7c708bdfd7e';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function manifestJson(matrixSha256 = MATRIX_SHA256): string {
  return JSON.stringify({
    schemaVersion: 1,
    localityCount: 2,
    localityIds: ['3011:bern', '8001:zurich'],
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT16_LE',
    unit: 'MINUTES',
    unreachableValue: 65_535,
    rounding: 'CEIL_SECONDS_TO_MINUTES',
    anchorsSha256: SHA_A,
    localityInputSha256: SHA_B,
    roadGraph: {
      sourcePbfSha256: SHA_A,
      osrmVersion: '26.8.0',
      profile: 'car.lua',
      algorithm: 'ch',
    },
    matrixByteLength: MATRIX_BYTES.byteLength,
    matrixSha256,
  });
}

const temporaryDirectories: string[] = [];

async function createFixture(
  matrixBytes: Uint8Array = MATRIX_BYTES,
): Promise<{ readonly manifestPath: string; readonly matrixPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'jm-commute-car-node-'));
  temporaryDirectories.push(directory);
  const manifestPath = join(directory, 'manifest.json');
  const matrixPath = join(directory, 'travel-times.bin');
  await Promise.all([
    writeFile(manifestPath, manifestJson()),
    writeFile(matrixPath, matrixBytes),
  ]);
  return { manifestPath, matrixPath };
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
    changedBytes[2] = 94;
    const paths = await createFixture(changedBytes);

    await expect(loadCarTravelTimeIndex(paths)).rejects.toThrow(
      'manifest expects c2eceddcfe024b7d28005019dfd2c45dcc71b59b1a5394ec9844c7c708bdfd7e',
    );
  });

  it('rejects a matrix with the wrong byte length before construction', async () => {
    const paths = await createFixture(MATRIX_BYTES.subarray(0, 6));

    await expect(loadCarTravelTimeIndex(paths)).rejects.toThrow(
      'has 6 bytes; manifest expects 8',
    );
  });

  it('reports manifest and matrix read failures with their paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jm-commute-car-node-'));
    temporaryDirectories.push(directory);
    const manifestPath = join(directory, 'missing-manifest.json');
    const matrixPath = join(directory, 'missing-matrix.bin');

    await expect(
      loadCarTravelTimeIndex({ manifestPath, matrixPath }),
    ).rejects.toThrow(`manifest at "${manifestPath}"`);

    await writeFile(manifestPath, manifestJson());
    await expect(
      loadCarTravelTimeIndex({ manifestPath, matrixPath }),
    ).rejects.toThrow(`matrix at "${matrixPath}"`);
  });
});

describe('resolveCarRuntimeDataPaths', () => {
  it('resolves only the fixed runtime artifact names from an explicit project root', () => {
    const projectRoot = join(tmpdir(), 'explicit-project-root');

    expect(resolveCarRuntimeDataPaths(projectRoot)).toEqual({
      directory: join(projectRoot, 'data', 'runtime', 'car'),
      manifestPath: join(
        projectRoot,
        'data',
        'runtime',
        'car',
        'manifest.json',
      ),
      matrixPath: join(
        projectRoot,
        'data',
        'runtime',
        'car',
        'travel-times.bin',
      ),
    });
  });

  it('rejects an omitted project-root path instead of falling back to cwd', () => {
    expect(() => resolveCarRuntimeDataPaths('')).toThrow('nonempty path');
    expect(() => resolveCarRuntimeDataPaths('   ')).toThrow('nonempty path');
  });
});
