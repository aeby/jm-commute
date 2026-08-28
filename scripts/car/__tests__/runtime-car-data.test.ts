import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authenticateRuntimeCarData,
  publishRuntimeCarData,
  type RuntimeCarDataPaths,
} from '../runtime-car-data';

const MATRIX_BYTES = Uint8Array.from([0, 0, 93, 0, 95, 0, 0, 0]);
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const temporaryDirectories: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function manifestValue(matrixSha256 = sha256(MATRIX_BYTES)): {
  readonly [key: string]: unknown;
} {
  return {
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
      sourcePbfSha256: SHA_B,
      osrmVersion: '26.8.0',
      profile: 'car.lua',
      algorithm: 'ch',
    },
    matrixByteLength: MATRIX_BYTES.byteLength,
    matrixSha256,
  };
}

function manifestBytes(
  value: Readonly<Record<string, unknown>> = manifestValue(),
): Uint8Array {
  // Leading/trailing whitespace proves publication retains source bytes rather
  // than replacing them with a normalized JSON serialization.
  return Buffer.from(`\n${JSON.stringify(value, null, 3)}\n`, 'utf8');
}

async function createPublicationFixture(): Promise<{
  readonly paths: RuntimeCarDataPaths;
  readonly sourceManifestBytes: Uint8Array;
  readonly sourceMatrixBytes: Uint8Array;
  readonly outputDirectory: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'jm-commute-runtime-car-'));
  temporaryDirectories.push(directory);
  const sourceDirectory = join(directory, 'processed');
  const outputDirectory = join(directory, 'runtime');
  await Promise.all([
    mkdir(sourceDirectory, { recursive: true }),
    mkdir(outputDirectory, { recursive: true }),
  ]);
  const paths = {
    sourceManifestPath: join(sourceDirectory, 'manifest.json'),
    sourceMatrixPath: join(sourceDirectory, 'travel-times.bin'),
    outputManifestPath: join(outputDirectory, 'manifest.json'),
    outputMatrixPath: join(outputDirectory, 'travel-times.bin'),
  };
  const sourceManifestBytes = manifestBytes();
  const sourceMatrixBytes = Uint8Array.from(MATRIX_BYTES);
  await Promise.all([
    writeFile(paths.sourceManifestPath, sourceManifestBytes),
    writeFile(paths.sourceMatrixPath, sourceMatrixBytes),
  ]);
  return {
    paths,
    sourceManifestBytes,
    sourceMatrixBytes,
    outputDirectory,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('authenticateRuntimeCarData', () => {
  it('uses the canonical strict parser and retains provenance structurally', () => {
    const authenticated = authenticateRuntimeCarData(
      manifestBytes(),
      MATRIX_BYTES,
      'fixture',
    );

    expect(authenticated.manifest.localityIds).toEqual([
      '3011:bern',
      '8001:zurich',
    ]);
    expect(authenticated.manifest.anchorsSha256).toBe(SHA_A);
    expect(authenticated.manifest.localityInputSha256).toBe(SHA_B);
    expect(authenticated.manifest.roadGraph).toEqual({
      sourcePbfSha256: SHA_B,
      osrmVersion: '26.8.0',
      profile: 'car.lua',
      algorithm: 'ch',
    });
    expect(authenticated.matrixSha256).toBe(sha256(MATRIX_BYTES));
  });

  it('rejects fields outside the canonical manifest contract', () => {
    const invalidManifest = {
      ...manifestValue(),
      generatedAt: '2026-08-28T12:00:00Z',
    };

    expect(() =>
      authenticateRuntimeCarData(
        manifestBytes(invalidManifest),
        MATRIX_BYTES,
        'fixture',
      ),
    ).toThrow('unexpected field(s) generatedAt');
  });

  it('rejects same-sized matrix corruption by SHA-256', () => {
    const corrupted = Uint8Array.from(MATRIX_BYTES);
    corrupted[2] = 94;

    expect(() =>
      authenticateRuntimeCarData(
        manifestBytes(),
        corrupted,
        'corrupt fixture',
      ),
    ).toThrow(`manifest expects ${sha256(MATRIX_BYTES)}`);
  });

  it('rejects a source manifest whose matrix SHA-256 is stale', () => {
    const staleSha256 = 'f'.repeat(64);

    expect(() =>
      authenticateRuntimeCarData(
        manifestBytes(manifestValue(staleSha256)),
        MATRIX_BYTES,
        'stale source fixture',
      ),
    ).toThrow(`manifest expects ${staleSha256}`);
  });

  it('rejects the wrong matrix byte length before checking its digest', () => {
    expect(() =>
      authenticateRuntimeCarData(
        manifestBytes(),
        MATRIX_BYTES.subarray(0, 6),
        'short fixture',
      ),
    ).toThrow('matrix has 6 bytes; manifest expects 8');
  });

  it('rejects authenticated bytes that violate runtime matrix invariants', () => {
    const nonzeroDiagonal = Uint8Array.from(MATRIX_BYTES);
    nonzeroDiagonal[0] = 1;

    expect(() =>
      authenticateRuntimeCarData(
        manifestBytes(manifestValue(sha256(nonzeroDiagonal))),
        nonzeroDiagonal,
        'structurally invalid fixture',
      ),
    ).toThrow('self cell for "3011:bern" must be 0');
  });

  it('rejects manifest bytes that are not valid UTF-8', () => {
    expect(() =>
      authenticateRuntimeCarData(
        Uint8Array.from([0xc3, 0x28]),
        MATRIX_BYTES,
        'invalid fixture',
      ),
    ).toThrow('manifest is not valid UTF-8');
  });
});

describe('publishRuntimeCarData', () => {
  it('preserves exact manifest and matrix bytes through staged publication', async () => {
    const fixture = await createPublicationFixture();

    const result = await publishRuntimeCarData(fixture.paths);

    const [publishedManifest, publishedMatrix] = await Promise.all([
      readFile(fixture.paths.outputManifestPath),
      readFile(fixture.paths.outputMatrixPath),
    ]);
    expect(publishedManifest).toEqual(Buffer.from(fixture.sourceManifestBytes));
    expect(publishedMatrix).toEqual(Buffer.from(fixture.sourceMatrixBytes));
    expect(result.localityCount).toBe(2);
    expect(result.manifest.byteLength).toBe(
      fixture.sourceManifestBytes.byteLength,
    );
    expect(result.manifest.sha256).toBe(
      sha256(fixture.sourceManifestBytes),
    );
    expect(result.matrix.byteLength).toBe(MATRIX_BYTES.byteLength);
    expect(result.matrix.sha256).toBe(sha256(MATRIX_BYTES));
    expect((await readdir(fixture.outputDirectory)).toSorted()).toEqual([
      'manifest.json',
      'travel-times.bin',
    ]);
  });

  it('produces identical authenticated artifacts on deterministic reruns', async () => {
    const fixture = await createPublicationFixture();

    const first = await publishRuntimeCarData(fixture.paths);
    const firstManifest = await readFile(fixture.paths.outputManifestPath);
    const firstMatrix = await readFile(fixture.paths.outputMatrixPath);
    const second = await publishRuntimeCarData(fixture.paths);
    const secondManifest = await readFile(fixture.paths.outputManifestPath);
    const secondMatrix = await readFile(fixture.paths.outputMatrixPath);

    expect(secondManifest).toEqual(firstManifest);
    expect(secondMatrix).toEqual(firstMatrix);
    expect(second.manifest.sha256).toBe(first.manifest.sha256);
    expect(second.matrix.sha256).toBe(first.matrix.sha256);
    expect(second.manifest.byteLength).toBe(first.manifest.byteLength);
    expect(second.matrix.byteLength).toBe(first.matrix.byteLength);
  });

  it('refuses publication when a source path overlaps an output path', async () => {
    const fixture = await createPublicationFixture();

    await expect(
      publishRuntimeCarData({
        ...fixture.paths,
        outputMatrixPath: fixture.paths.sourceMatrixPath,
      }),
    ).rejects.toThrow('paths overlap');
  });
});
