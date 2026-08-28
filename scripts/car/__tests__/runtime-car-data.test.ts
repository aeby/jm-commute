import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authenticateRuntimeCarData,
  authenticateSourceCarData,
  convertCarTravelTimeMatrixToRuntime,
  publishRuntimeCarData,
  type RuntimeCarDataPaths,
} from '../runtime-car-data';

const SOURCE_VALUES = [
  0, 1, 120, 121,
  180, 0, 239, 240,
  241, 254, 0, 431,
  65_535, 120, 240, 0,
] as const;
const EXPECTED_RUNTIME_VALUES = [
  0, 1, 120, 121,
  180, 0, 239, 240,
  255, 255, 0, 255,
  255, 120, 240, 0,
] as const;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const temporaryDirectories: string[] = [];

function encodeSource(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}

const SOURCE_MATRIX_BYTES = encodeSource(SOURCE_VALUES);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceManifestValue(
  matrixSha256 = sha256(SOURCE_MATRIX_BYTES),
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    localityCount: 4,
    localityIds: ['A', 'B', 'C', 'D'],
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
    matrixByteLength: SOURCE_MATRIX_BYTES.byteLength,
    matrixSha256,
  };
}

function sourceManifestBytes(
  value: Readonly<Record<string, unknown>> = sourceManifestValue(),
): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
  const manifestBytes = sourceManifestBytes();
  const matrixBytes = Uint8Array.from(SOURCE_MATRIX_BYTES);
  await Promise.all([
    writeFile(paths.sourceManifestPath, manifestBytes),
    writeFile(paths.sourceMatrixPath, matrixBytes),
  ]);
  return {
    paths,
    sourceManifestBytes: manifestBytes,
    sourceMatrixBytes: matrixBytes,
    outputDirectory,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('convertCarTravelTimeMatrixToRuntime', () => {
  it('applies the exact 0–240/255 conversion without mutating the source', () => {
    const matrixBytes = Uint8Array.from(SOURCE_MATRIX_BYTES);
    const originalBytes = Uint8Array.from(matrixBytes);

    const converted = convertCarTravelTimeMatrixToRuntime(
      sourceManifestBytes(),
      matrixBytes,
      'fixture',
    );

    expect([...converted.matrixBytes]).toEqual(EXPECTED_RUNTIME_VALUES);
    expect(matrixBytes).toEqual(originalBytes);
    expect(converted.manifest.mode).toBe('CAR');
    expect(converted.manifest.matrix.maxTravelMinutes).toBe(240);
    expect(converted.manifest.matrix.valueEncoding).toBe('UINT8');
    expect(converted.manifest.matrix.localityIds).toEqual(['A', 'B', 'C', 'D']);
    expect(converted.manifest.source).toEqual({
      sourceMatrixSha256: sha256(SOURCE_MATRIX_BYTES),
      anchorsSha256: SHA_A,
      localityInputSha256: SHA_B,
      roadGraph: {
        sourcePbfSha256: SHA_B,
        osrmVersion: '26.8.0',
        profile: 'car.lua',
        algorithm: 'ch',
      },
    });
    expect(converted.statistics).toEqual({
      totalCells: 16,
      cellsRetainedZeroTo120: 7,
      cellsRetained121To240: 5,
      cellsConvertedAbove240: 3,
      cellsConvertedFromSourceUnavailable: 1,
      zeroMinuteCells: 4,
      exact120MinuteCells: 2,
      exact240MinuteCells: 2,
      unavailableCells: 4,
    });
  });

  it('is deterministic for identical authenticated source bytes', () => {
    const first = convertCarTravelTimeMatrixToRuntime(
      sourceManifestBytes(),
      SOURCE_MATRIX_BYTES,
    );
    const second = convertCarTravelTimeMatrixToRuntime(
      sourceManifestBytes(),
      SOURCE_MATRIX_BYTES,
    );

    expect(second.manifestBytes).toEqual(first.manifestBytes);
    expect(second.matrixBytes).toEqual(first.matrixBytes);
  });

  it('rejects malformed, corrupted, and nonzero-diagonal source data', () => {
    const malformedManifest = {
      ...sourceManifestValue(),
      valueEncoding: 'UINT8',
    };
    expect(() =>
      convertCarTravelTimeMatrixToRuntime(
        sourceManifestBytes(malformedManifest),
        SOURCE_MATRIX_BYTES,
      ),
    ).toThrow('expected "UINT16_LE"');

    const corrupted = Uint8Array.from(SOURCE_MATRIX_BYTES);
    corrupted[2] = 2;
    expect(() =>
      convertCarTravelTimeMatrixToRuntime(sourceManifestBytes(), corrupted),
    ).toThrow('manifest expects');

    const nonzeroDiagonal = Uint8Array.from(SOURCE_MATRIX_BYTES);
    new DataView(nonzeroDiagonal.buffer).setUint16(0, 1, true);
    expect(() =>
      convertCarTravelTimeMatrixToRuntime(
        sourceManifestBytes(sourceManifestValue(sha256(nonzeroDiagonal))),
        nonzeroDiagonal,
      ),
    ).toThrow('must remain 0');
  });
});

describe('runtime car data authentication and publication', () => {
  it('authenticates both source and converted runtime contracts', () => {
    const source = authenticateSourceCarData(
      sourceManifestBytes(),
      SOURCE_MATRIX_BYTES,
    );
    const converted = convertCarTravelTimeMatrixToRuntime(
      sourceManifestBytes(),
      SOURCE_MATRIX_BYTES,
    );
    const runtime = authenticateRuntimeCarData(
      converted.manifestBytes,
      converted.matrixBytes,
    );

    expect(source.matrixSha256).toBe(sha256(SOURCE_MATRIX_BYTES));
    expect(runtime.manifest).toEqual(converted.manifest);
    expect(runtime.matrixSha256).toBe(sha256(converted.matrixBytes));
  });

  it('publishes authenticated converted bytes and leaves source bytes unchanged', async () => {
    const fixture = await createPublicationFixture();
    const expected = convertCarTravelTimeMatrixToRuntime(
      fixture.sourceManifestBytes,
      fixture.sourceMatrixBytes,
    );

    const result = await publishRuntimeCarData(fixture.paths);
    const [publishedManifest, publishedMatrix, sourceManifest, sourceMatrix] =
      await Promise.all([
        readFile(fixture.paths.outputManifestPath),
        readFile(fixture.paths.outputMatrixPath),
        readFile(fixture.paths.sourceManifestPath),
        readFile(fixture.paths.sourceMatrixPath),
      ]);

    expect(publishedManifest).toEqual(Buffer.from(expected.manifestBytes));
    expect(publishedMatrix).toEqual(Buffer.from(expected.matrixBytes));
    expect(sourceManifest).toEqual(Buffer.from(fixture.sourceManifestBytes));
    expect(sourceMatrix).toEqual(Buffer.from(fixture.sourceMatrixBytes));
    expect(result.matrix.byteLength).toBe(16);
    expect(result.sourceMatrix.byteLength).toBe(32);
    expect((await readdir(fixture.outputDirectory)).toSorted()).toEqual([
      'manifest.json',
      'travel-times.bin',
    ]);
  });

  it('produces byte-identical artifacts on deterministic reruns', async () => {
    const fixture = await createPublicationFixture();

    const first = await publishRuntimeCarData(fixture.paths);
    const firstManifest = await readFile(fixture.paths.outputManifestPath);
    const firstMatrix = await readFile(fixture.paths.outputMatrixPath);
    const second = await publishRuntimeCarData(fixture.paths);

    expect(await readFile(fixture.paths.outputManifestPath)).toEqual(firstManifest);
    expect(await readFile(fixture.paths.outputMatrixPath)).toEqual(firstMatrix);
    expect(second.manifest.sha256).toBe(first.manifest.sha256);
    expect(second.matrix.sha256).toBe(first.matrix.sha256);
  });

  it('refuses publication when source and output paths overlap', async () => {
    const fixture = await createPublicationFixture();

    await expect(
      publishRuntimeCarData({
        ...fixture.paths,
        outputMatrixPath: fixture.paths.sourceMatrixPath,
      }),
    ).rejects.toThrow('paths overlap');
  });
});
