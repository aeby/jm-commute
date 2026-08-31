import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LocalityRoutingStopIndex } from '../../network/localities/types';
import type { PublicTransportNetwork } from '../../network/timetable/types';
import {
  calculateTravelTimes,
  type PublicTransportMatrixProvenance,
} from '../calculate-travel-times';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function network(): PublicTransportNetwork {
  return {
    sourceStopIds: ['shared-stop'],
    patterns: [],
    routingWindowStartSeconds: 7 * 60 * 60,
    routingWindowEndSeconds: 9 * 60 * 60,
    patternOccurrencesByStop: [new Uint32Array()],
    transfersByStop: [new Uint32Array()],
    accessTransfersByStop: [new Uint32Array()],
  };
}

function localities(count: number): LocalityRoutingStopIndex {
  return {
    entries: Array.from({ length: count }, (_, index) => ({
      localityId: `0000:place-${index.toString().padStart(2, '0')}`,
      stopIndexes: Uint32Array.of(0),
    })),
  };
}

function provenance(): PublicTransportMatrixProvenance {
  return {
    serviceDate: '2026-09-07',
    morningWindow: { start: '07:00:00', end: '09:00:00' },
    gtfsFeedVersion: 'fixture',
    routingDataFingerprint: 'a'.repeat(64),
    maxTransfers: 0,
    minTransferTimeSeconds: 120,
  };
}

describe('calculateTravelTimes', () => {
  it('rejects routing-window provenance that differs from the built network', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'jm-public-transport-matrix-window-'),
    );
    temporaryDirectories.push(directory);
    const workDirectory = join(directory, 'work');
    const paths = {
      workDirectory,
      manifestPath: join(directory, 'runtime', 'manifest.json'),
      matrixPath: join(directory, 'runtime', 'travel-times.bin'),
    };
    const localityRoutingIndex = localities(1);

    for (const value of [
      { ...network(), routingWindowStartSeconds: 6 * 60 * 60 },
      { ...network(), routingWindowEndSeconds: 10 * 60 * 60 },
    ]) {
      await expect(
        calculateTravelTimes({
          network: value,
          localityRoutingIndex,
          provenance: provenance(),
          paths,
        }),
      ).rejects.toThrow(/does not match network routing window/i);
    }
    await expect(stat(workDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects nested publication paths before writing work files', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'jm-public-transport-matrix-paths-'),
    );
    temporaryDirectories.push(directory);
    const workDirectory = join(directory, 'work');

    await expect(
      calculateTravelTimes({
        network: network(),
        localityRoutingIndex: localities(1),
        provenance: provenance(),
        paths: {
          workDirectory,
          manifestPath: join(workDirectory, 'published', 'manifest.json'),
          matrixPath: join(workDirectory, 'published', 'travel-times.bin'),
        },
      }),
    ).rejects.toThrow(/publication paths must be outside the work directory/i);
    await expect(stat(workDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resumes completed row blocks, validates, publishes, and cleans work state', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'jm-public-transport-matrix-'),
    );
    temporaryDirectories.push(directory);
    const workDirectory = join(directory, 'work');
    const paths = {
      workDirectory,
      manifestPath: join(directory, 'runtime', 'manifest.json'),
      matrixPath: join(directory, 'runtime', 'travel-times.bin'),
    };
    const value = network();
    const localityRoutingIndex = localities(11);

    await expect(
      calculateTravelTimes({
        network: value,
        localityRoutingIndex,
        provenance: provenance(),
        paths,
        onProgress: ({ completedOrigins }) => {
          if (completedOrigins === 10) {
            throw new Error('simulated interruption');
          }
        },
      }),
    ).rejects.toThrow('simulated interruption');

    expect(
      JSON.parse(await readFile(join(workDirectory, 'checkpoint.json'), 'utf8')),
    ).toMatchObject({ nextOriginIndex: 10, localityCount: 11 });
    expect(
      (await stat(join(workDirectory, 'travel-times.bin.partial'))).size,
    ).toBe(110);

    const progress: number[] = [];
    const result = await calculateTravelTimes({
      network: value,
      localityRoutingIndex,
      provenance: provenance(),
      paths,
      onProgress: ({ completedOrigins }) => {
        progress.push(completedOrigins);
      },
    });

    expect(progress).toEqual([11]);
    expect(result.manifest.source).toEqual({
      gtfsFeed: 'fixture',
      serviceDate: '2026-09-07',
      morningWindow: '07:00:00-09:00:00',
    });
    expect(result.manifest.date).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(result.manifest.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.matrixByteLength).toBe(121);
    expect(result.validation).toEqual({ sampleSize: 55, exactMatches: 55 });
    expect(await readFile(paths.matrixPath)).toEqual(Buffer.alloc(121));
    expect(
      JSON.parse(await readFile(paths.manifestPath, 'utf8')),
    ).toEqual(result.manifest);
    await expect(stat(workDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
