import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyRuntimeTransitData } from '../runtime-data-verification';
import {
  RUNTIME_TRANSIT_MATRIX_BYTES,
  runtimeTransitManifestBytes,
} from './runtime-data-fixture';

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const projectRoot = await mkdtemp(
    join(tmpdir(), 'jm-commute-runtime-transit-verification-'),
  );
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

function runtimePaths(projectRoot: string) {
  const runtimeDataDirectory = join(projectRoot, 'data', 'runtime', 'transit');
  return {
    runtimeDataDirectory,
    manifestPath: join(runtimeDataDirectory, 'manifest.json'),
    matrixPath: join(runtimeDataDirectory, 'travel-times.bin'),
  };
}

async function writeRuntimeFixture(projectRoot: string): Promise<void> {
  const paths = runtimePaths(projectRoot);
  await mkdir(paths.runtimeDataDirectory, { recursive: true });
  await Promise.all([
    writeFile(paths.manifestPath, runtimeTransitManifestBytes()),
    writeFile(paths.matrixPath, RUNTIME_TRANSIT_MATRIX_BYTES),
  ]);
}

async function writeProcessedFixture(projectRoot: string): Promise<void> {
  const directory = join(
    projectRoot,
    'data',
    'processed',
    'transit',
    'travel-time-matrix',
  );
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'manifest.json'), runtimeTransitManifestBytes()),
    writeFile(join(directory, 'travel-times.bin'), RUNTIME_TRANSIT_MATRIX_BYTES),
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('verifyRuntimeTransitData', () => {
  it('authenticates and queries only runtime assets through the public façade', async () => {
    const projectRoot = await createProjectRoot();
    await writeRuntimeFixture(projectRoot);
    const paths = runtimePaths(projectRoot);

    const verification = await verifyRuntimeTransitData({
      ...paths,
      pointChecks: [
        {
          label: 'A to B',
          fromLocalityId: 'A',
          toLocalityId: 'B',
          expectedTravelMinutes: 20,
        },
        {
          label: 'B to A',
          fromLocalityId: 'B',
          toLocalityId: 'A',
          expectedTravelMinutes: 25,
        },
      ],
      reachabilityChecks: [
        {
          label: 'A within 20 minutes',
          originLocalityId: 'A',
          maxTravelMinutes: 20,
          expectedReachableLocalityCount: 2,
        },
        {
          label: 'B within the full horizon',
          originLocalityId: 'B',
          maxTravelMinutes: 240,
          expectedReachableLocalityCount: 2,
        },
      ],
    });

    expect(verification.pointResults.map(({ travelMinutes }) => travelMinutes)).toEqual([
      20,
      25,
    ]);
    expect(
      verification.reachabilityResults.map(
        ({ reachableLocalityCount }) => reachableLocalityCount,
      ),
    ).toEqual([2, 2]);
  });

  it('does not fall back to valid preprocessing matrix paths', async () => {
    const projectRoot = await createProjectRoot();
    await writeProcessedFixture(projectRoot);
    const paths = runtimePaths(projectRoot);

    await expect(
      verifyRuntimeTransitData({
        ...paths,
        pointChecks: [
          {
            label: 'A to B',
            fromLocalityId: 'A',
            toLocalityId: 'B',
            expectedTravelMinutes: 20,
          },
        ],
        reachabilityChecks: [
          {
            label: 'A at 20',
            originLocalityId: 'A',
            maxTravelMinutes: 20,
            expectedReachableLocalityCount: 2,
          },
        ],
      }),
    ).rejects.toThrow(`manifest at "${paths.manifestPath}"`);
  });

  it('rejects malformed runtime files before executing queries', async () => {
    const projectRoot = await createProjectRoot();
    await writeRuntimeFixture(projectRoot);
    const paths = runtimePaths(projectRoot);
    await writeFile(paths.matrixPath, RUNTIME_TRANSIT_MATRIX_BYTES.subarray(0, 3));

    await expect(
      verifyRuntimeTransitData({
        ...paths,
        pointChecks: [
          {
            label: 'A to B',
            fromLocalityId: 'A',
            toLocalityId: 'B',
            expectedTravelMinutes: 20,
          },
        ],
        reachabilityChecks: [
          {
            label: 'A at 20',
            originLocalityId: 'A',
            maxTravelMinutes: 20,
            expectedReachableLocalityCount: 2,
          },
        ],
      }),
    ).rejects.toThrow('has 3 bytes; manifest expects 4');
  });

  it('requires both point and reachability query categories', async () => {
    const projectRoot = await createProjectRoot();
    const paths = runtimePaths(projectRoot);

    await expect(
      verifyRuntimeTransitData({
        ...paths,
        pointChecks: [],
        reachabilityChecks: [
          {
            label: 'unused',
            originLocalityId: 'A',
            maxTravelMinutes: 20,
            expectedReachableLocalityCount: 2,
          },
        ],
      }),
    ).rejects.toThrow('at least one point check');
    await expect(
      verifyRuntimeTransitData({
        ...paths,
        pointChecks: [
          {
            label: 'unused',
            fromLocalityId: 'A',
            toLocalityId: 'B',
            expectedTravelMinutes: 20,
          },
        ],
        reachabilityChecks: [],
      }),
    ).rejects.toThrow('at least one reachability check');
  });

  it('aggregates point and reachability baseline mismatches', async () => {
    const projectRoot = await createProjectRoot();
    await writeRuntimeFixture(projectRoot);
    const paths = runtimePaths(projectRoot);

    await expect(
      verifyRuntimeTransitData({
        ...paths,
        pointChecks: [
          {
            label: 'wrong point',
            fromLocalityId: 'A',
            toLocalityId: 'B',
            expectedTravelMinutes: 21,
          },
        ],
        reachabilityChecks: [
          {
            label: 'wrong reachability',
            originLocalityId: 'A',
            maxTravelMinutes: 20,
            expectedReachableLocalityCount: 1,
          },
        ],
      }),
    ).rejects.toThrow(
      /found 2 mismatch\(es\):[\s\S]*wrong point: expected 21 min, received 20 min[\s\S]*wrong reachability: expected 1 reachable localities, received 2/u,
    );
  });
});
