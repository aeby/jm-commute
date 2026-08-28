import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveCarRuntimeDataPaths } from '@core/car/node';

import { verifyRuntimeCarData } from '../runtime-car-data-verification';

const MATRIX_BYTES = Uint8Array.from([0, 0, 93, 0, 95, 0, 0, 0]);
const MATRIX_SHA256 =
  'c2eceddcfe024b7d28005019dfd2c45dcc71b59b1a5394ec9844c7c708bdfd7e';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function manifestJson(): string {
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
    matrixSha256: MATRIX_SHA256,
  });
}

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const projectRoot = await mkdtemp(
    join(tmpdir(), 'jm-commute-runtime-car-verification-'),
  );
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

async function writeRuntimeFixture(projectRoot: string): Promise<void> {
  const paths = resolveCarRuntimeDataPaths(projectRoot);
  await mkdir(paths.directory, { recursive: true });
  await Promise.all([
    writeFile(paths.manifestPath, manifestJson()),
    writeFile(paths.matrixPath, MATRIX_BYTES),
  ]);
}

async function writePreprocessingFixture(
  projectRoot: string,
): Promise<void> {
  const directory = join(
    projectRoot,
    'data',
    'processed',
    'car',
    'travel-time-matrix',
  );
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'manifest.json'), manifestJson()),
    writeFile(join(directory, 'travel-times.bin'), MATRIX_BYTES),
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('verifyRuntimeCarData', () => {
  it('initializes and queries only the resolved runtime artifacts', async () => {
    const projectRoot = await createProjectRoot();
    await writeRuntimeFixture(projectRoot);
    const paths = resolveCarRuntimeDataPaths(projectRoot);

    const verification = await verifyRuntimeCarData({
      ...paths,
      pointChecks: [
        {
          label: 'Bern to Zürich',
          fromLocalityId: '3011:bern',
          toLocalityId: '8001:zurich',
          expectedTravelMinutes: 93,
        },
        {
          label: 'Zürich to Bern',
          fromLocalityId: '8001:zurich',
          toLocalityId: '3011:bern',
          expectedTravelMinutes: 95,
        },
      ],
      reachabilityChecks: [
        {
          label: 'Bern within 93 minutes',
          originLocalityId: '3011:bern',
          maxTravelMinutes: 93,
          expectedReachableLocalityCount: 2,
        },
        {
          label: 'Zürich within 94 minutes',
          originLocalityId: '8001:zurich',
          maxTravelMinutes: 94,
          expectedReachableLocalityCount: 1,
        },
      ],
    });

    expect(verification.manifestPath).toBe(paths.manifestPath);
    expect(verification.matrixPath).toBe(paths.matrixPath);
    expect(verification.pointChecks.map(({ travelMinutes }) => travelMinutes)).toEqual([
      93,
      95,
    ]);
    expect(
      verification.reachabilityChecks.map(
        ({ reachableLocalityCount }) => reachableLocalityCount,
      ),
    ).toEqual([2, 1]);
  });

  it('does not fall back to valid-looking preprocessing paths', async () => {
    const projectRoot = await createProjectRoot();
    await writePreprocessingFixture(projectRoot);
    const paths = resolveCarRuntimeDataPaths(projectRoot);

    await expect(
      verifyRuntimeCarData({
        ...paths,
        pointChecks: [
          {
            label: 'Bern to Zürich',
            fromLocalityId: '3011:bern',
            toLocalityId: '8001:zurich',
            expectedTravelMinutes: 93,
          },
        ],
        reachabilityChecks: [
          {
            label: 'Bern within 90 minutes',
            originLocalityId: '3011:bern',
            maxTravelMinutes: 90,
            expectedReachableLocalityCount: 1,
          },
        ],
      }),
    ).rejects.toThrow(`manifest at "${paths.manifestPath}"`);
  });

  it('rejects a truncated runtime matrix before running queries', async () => {
    const projectRoot = await createProjectRoot();
    await writeRuntimeFixture(projectRoot);
    const paths = resolveCarRuntimeDataPaths(projectRoot);
    await writeFile(paths.matrixPath, MATRIX_BYTES.subarray(0, 6));

    await expect(
      verifyRuntimeCarData({
        ...paths,
        pointChecks: [
          {
            label: 'Bern to Zürich',
            fromLocalityId: '3011:bern',
            toLocalityId: '8001:zurich',
            expectedTravelMinutes: 93,
          },
        ],
        reachabilityChecks: [
          {
            label: 'Bern within 90 minutes',
            originLocalityId: '3011:bern',
            maxTravelMinutes: 90,
            expectedReachableLocalityCount: 1,
          },
        ],
      }),
    ).rejects.toThrow('has 6 bytes; manifest expects 8');
  });

  it('requires both verification query kinds', async () => {
    const projectRoot = await createProjectRoot();
    const paths = resolveCarRuntimeDataPaths(projectRoot);
    await expect(
      verifyRuntimeCarData({
        ...paths,
        pointChecks: [],
        reachabilityChecks: [
          {
            label: 'unused',
            originLocalityId: '3011:bern',
            maxTravelMinutes: 90,
            expectedReachableLocalityCount: 1,
          },
        ],
      }),
    ).rejects.toThrow('at least one point check');
    await expect(
      verifyRuntimeCarData({
        ...paths,
        pointChecks: [
          {
            label: 'unused',
            fromLocalityId: '3011:bern',
            toLocalityId: '8001:zurich',
            expectedTravelMinutes: 93,
          },
        ],
        reachabilityChecks: [],
      }),
    ).rejects.toThrow('at least one reachability check');
  });

  it('aggregates point and reachability baseline mismatches', async () => {
    const projectRoot = await createProjectRoot();
    await writeRuntimeFixture(projectRoot);
    const paths = resolveCarRuntimeDataPaths(projectRoot);

    await expect(
      verifyRuntimeCarData({
        ...paths,
        pointChecks: [
          {
            label: 'wrong point baseline',
            fromLocalityId: '3011:bern',
            toLocalityId: '8001:zurich',
            expectedTravelMinutes: 94,
          },
        ],
        reachabilityChecks: [
          {
            label: 'wrong reachability baseline',
            originLocalityId: '3011:bern',
            maxTravelMinutes: 93,
            expectedReachableLocalityCount: 1,
          },
        ],
      }),
    ).rejects.toThrow(
      /found 2 mismatch\(es\):[\s\S]*wrong point baseline: expected 94 min, received 93 min[\s\S]*wrong reachability baseline: expected 1 reachable localities, received 2/u,
    );
  });
});
