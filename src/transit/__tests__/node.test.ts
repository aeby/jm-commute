import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getTransitTravelMinutes } from '../index';
import { loadTransitTravelTimeIndex } from '../node';
import { TRANSIT_MATRIX_BYTES, transitManifest } from './travel-time-fixture';

const temporaryDirectories: string[] = [];
const MATRIX_SHA256 = createHash('sha256')
  .update(TRANSIT_MATRIX_BYTES)
  .digest('hex');

async function createFixture(
  matrixBytes: Uint8Array = TRANSIT_MATRIX_BYTES,
): Promise<{ readonly runtimeDataDirectory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'jm-commute-transit-node-'));
  temporaryDirectories.push(directory);
  const manifestPath = join(directory, 'manifest.json');
  const matrixPath = join(directory, 'travel-times.bin');
  await Promise.all([
    writeFile(
      manifestPath,
      JSON.stringify(transitManifest(MATRIX_SHA256)),
      'utf8',
    ),
    writeFile(matrixPath, matrixBytes),
  ]);
  return { runtimeDataDirectory: directory };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('loadTransitTravelTimeIndex', () => {
  it('authenticates runtime-only files and constructs the transit index', async () => {
    const paths = await createFixture();

    const index = await loadTransitTravelTimeIndex(paths);

    expect(getTransitTravelMinutes(index, 'A', 'B')).toBe(20);
    expect(getTransitTravelMinutes(index, 'B', 'A')).toBe(25);
  });

  it('rejects same-sized SHA corruption and wrong byte lengths', async () => {
    const corrupted = Uint8Array.from(TRANSIT_MATRIX_BYTES);
    corrupted[1] = 21;
    const corruptedPaths = await createFixture(corrupted);
    await expect(
      loadTransitTravelTimeIndex(corruptedPaths),
    ).rejects.toThrow(`manifest expects ${MATRIX_SHA256}`);

    const shortPaths = await createFixture(TRANSIT_MATRIX_BYTES.subarray(0, 15));
    await expect(loadTransitTravelTimeIndex(shortPaths)).rejects.toThrow(
      'has 15 bytes; manifest expects 16',
    );
  });

  it('reports missing runtime-only files with their explicit paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jm-commute-transit-node-'));
    temporaryDirectories.push(directory);
    const manifestPath = join(directory, 'manifest.json');
    const matrixPath = join(directory, 'travel-times.bin');

    await expect(
      loadTransitTravelTimeIndex({ runtimeDataDirectory: directory }),
    ).rejects.toThrow(`manifest at "${manifestPath}"`);
    await writeFile(
      manifestPath,
      JSON.stringify(transitManifest(MATRIX_SHA256)),
      'utf8',
    );
    await expect(
      loadTransitTravelTimeIndex({ runtimeDataDirectory: directory }),
    ).rejects.toThrow(`matrix at "${matrixPath}"`);
  });
});
