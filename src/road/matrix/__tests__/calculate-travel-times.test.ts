import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RoadNetwork, RoadRouter } from '../../network';
import { calculateTravelTimes } from '../calculate-travel-times';

function duration(origin: number, destination: number): number | undefined {
  if (origin === 2 && destination === 0) {
    return undefined;
  }
  if (origin === 0 && destination === 2) {
    return 241 * 60;
  }
  return (origin * 10 + destination + 1) * 60;
}

function router(): RoadRouter {
  return {
    async findNearestRoadPoint(coordinate) {
      return { ...coordinate, distanceMeters: 0 };
    },
    async getDurationTable(sources, destinations) {
      return {
        durationsSeconds: sources.map((source) =>
          destinations.map((destination) =>
            duration(source.latitude, destination.latitude),
          ),
        ),
      };
    },
    async estimateRoute(from, to) {
      const durationSeconds = duration(from.latitude, to.latitude);
      return durationSeconds === undefined ? undefined : { durationSeconds };
    },
  };
}

function network(networkRouter: RoadRouter = router()): RoadNetwork {
  return {
    router: networkRouter,
    localities: [0, 1, 2].map((index) => ({
      localityId: `${index}:locality`,
      latitude: index,
      longitude: index,
      snapDistanceMeters: 0,
    })),
    localityInputSha256: 'a'.repeat(64),
    anchorsSha256: 'b'.repeat(64),
    roadGraph: {
      sourcePbfSha256: 'c'.repeat(64),
      osrmVersion: '26.8.0',
      profile: 'car.lua',
      algorithm: 'ch',
    },
  };
}

const config = {
  blockSize: 2,
  requestConcurrency: 2,
  maxRequestAttempts: 1,
  retryDelaysMilliseconds: [],
  validationSampleSize: 6,
} as const;

describe('calculateTravelTimes', () => {
  it('publishes the final authenticated matrix without another representation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'road-matrix-'));
    const workDirectory = join(directory, 'work');
    const paths = {
      workDirectory,
      manifestPath: join(directory, 'runtime', 'manifest.json'),
      matrixPath: join(directory, 'runtime', 'travel-times.bin'),
    };

    const result = await calculateTravelTimes({
      network: network(),
      config,
      paths,
    });
    expect([...await readFile(paths.matrixPath)]).toEqual([
      0, 2, 255,
      11, 0, 13,
      255, 22, 0,
    ]);
    const manifest = JSON.parse(
      await readFile(paths.manifestPath, 'utf8'),
    ) as typeof result.manifest;
    expect(manifest.source).toEqual({
      openStreetMap: 'c'.repeat(64),
      localityAnchors: 'b'.repeat(64),
      routingEngine: 'OSRM 26.8.0 / road / ch',
    });
    expect(Object.keys(manifest)).toEqual(['date', 'fingerprint', 'source']);
    expect(manifest.fingerprint).toBe(result.fingerprint);
    expect(result.validation).toEqual({ sampleSize: 6, exactMatches: 6 });
    await expect(stat(workDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resumes only after the last durably completed origin block', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'road-matrix-resume-'));
    const paths = {
      workDirectory: join(directory, 'work'),
      manifestPath: join(directory, 'runtime', 'manifest.json'),
      matrixPath: join(directory, 'runtime', 'travel-times.bin'),
    };
    const interruptedRouter = router();
    const getDurationTable = interruptedRouter.getDurationTable.bind(
      interruptedRouter,
    );
    interruptedRouter.getDurationTable = async (sources, destinations) => {
      if (sources[0]?.latitude === 2) {
        throw new Error('interrupted');
      }
      return await getDurationTable(sources, destinations);
    };

    await expect(
      calculateTravelTimes({
        network: network(interruptedRouter),
        config,
        paths,
      }),
    ).rejects.toThrow('OSRM table rows 2-2');
    expect((await readFile(join(paths.workDirectory, 'travel-times.bin.partial'))).length)
      .toBe(6);

    const resumedOrigins: number[] = [];
    const resumedRouter = router();
    const resumedTable = resumedRouter.getDurationTable.bind(resumedRouter);
    resumedRouter.getDurationTable = async (sources, destinations) => {
      resumedOrigins.push(...sources.map(({ latitude }) => latitude));
      return await resumedTable(sources, destinations);
    };
    await calculateTravelTimes({
      network: network(resumedRouter),
      config,
      paths,
    });

    expect(new Set(resumedOrigins)).toEqual(new Set([2]));
    expect([...await readFile(paths.matrixPath)]).toEqual([
      0, 2, 255,
      11, 0, 13,
      255, 22, 0,
    ]);
  });
});
