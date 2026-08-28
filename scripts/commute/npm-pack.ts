import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { COMMUTE_PACKAGE_DIRECTORY, PROJECT_ROOT } from './paths';
import { runCommand } from './run-command';

export interface NpmPackFile {
  readonly path: string;
  readonly size: number;
  readonly mode: number;
}

export interface NpmPackResult {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly size: number;
  readonly unpackedSize: number;
  readonly shasum: string;
  readonly integrity: string;
  readonly filename: string;
  readonly files: readonly NpmPackFile[];
  readonly tarballPath: string;
  readonly elapsedMilliseconds: number;
  readonly outputDirectory: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePackOutput(
  stdout: string,
  outputDirectory: string,
  elapsedMilliseconds: number,
): NpmPackResult {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm pack returned malformed JSON:\n${stdout}`, {
      cause: error,
    });
  }
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    throw new Error('npm pack must return exactly one package description.');
  }
  const result = value[0];
  const requiredStrings = [
    'id',
    'name',
    'version',
    'shasum',
    'integrity',
    'filename',
  ] as const;
  for (const field of requiredStrings) {
    if (typeof result[field] !== 'string' || result[field].length === 0) {
      throw new Error(`npm pack result has an invalid ${field}.`);
    }
  }
  if (
    !Number.isSafeInteger(result.size) ||
    (result.size as number) <= 0 ||
    !Number.isSafeInteger(result.unpackedSize) ||
    (result.unpackedSize as number) <= 0
  ) {
    throw new Error('npm pack result has invalid package sizes.');
  }
  if (!Array.isArray(result.files)) {
    throw new Error('npm pack result is missing its file inventory.');
  }

  const files: NpmPackFile[] = result.files.map((file, index) => {
    if (
      !isRecord(file) ||
      typeof file.path !== 'string' ||
      !Number.isSafeInteger(file.size) ||
      !Number.isSafeInteger(file.mode)
    ) {
      throw new Error(`npm pack result has an invalid files[${index}] entry.`);
    }
    return {
      path: file.path,
      size: file.size as number,
      mode: file.mode as number,
    };
  });

  const filename = result.filename as string;
  return {
    id: result.id as string,
    name: result.name as string,
    version: result.version as string,
    size: result.size as number,
    unpackedSize: result.unpackedSize as number,
    shasum: result.shasum as string,
    integrity: result.integrity as string,
    filename,
    files,
    tarballPath: resolve(outputDirectory, filename),
    elapsedMilliseconds,
    outputDirectory,
  };
}

export async function createNpmPackageTarball(
  requestedOutputDirectory?: string,
): Promise<NpmPackResult> {
  const outputDirectory = requestedOutputDirectory === undefined
    ? await mkdtemp(resolve(tmpdir(), 'jm-commute-pack-'))
    : isAbsolute(requestedOutputDirectory)
      ? requestedOutputDirectory
      : resolve(PROJECT_ROOT, requestedOutputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const npmCacheDirectory = resolve(outputDirectory, '.npm-cache');

  const command = await runCommand(
    'npm',
    [
      'pack',
      '--json',
      '--offline',
      '--pack-destination',
      outputDirectory,
      '--cache',
      npmCacheDirectory,
      COMMUTE_PACKAGE_DIRECTORY,
    ],
    { cwd: PROJECT_ROOT, captureOutput: true },
  );
  return parsePackOutput(
    command.stdout,
    outputDirectory,
    command.elapsedMilliseconds,
  );
}

export function assertExpectedPackageInventory(result: NpmPackResult): void {
  if (result.name !== '@jm/commute') {
    throw new Error(`Packed unexpected package ${result.name}.`);
  }
  const paths = new Set(result.files.map((file) => file.path));
  for (const requiredPath of [
    'package.json',
    'README.md',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/node.js',
    'dist/node.d.ts',
    'data/localities.json',
    'data/car/manifest.json',
    'data/car/travel-times.bin',
    'data/transit/manifest.json',
    'data/transit/travel-times.bin',
  ]) {
    if (!paths.has(requiredPath)) {
      throw new Error(`Packed package is missing ${requiredPath}.`);
    }
  }

  const forbiddenPath = result.files.find(({ path }) =>
    path.startsWith('src/') ||
    path.includes('/__tests__/') ||
    path.includes('preprocessing') ||
    path.includes('raptor') ||
    path.endsWith('.map')
  );
  if (forbiddenPath !== undefined) {
    throw new Error(
      `Packed package unexpectedly contains ${forbiddenPath.path}.`,
    );
  }

  const allowedDataPaths = new Set([
    'data/localities.json',
    'data/car/manifest.json',
    'data/car/travel-times.bin',
    'data/transit/manifest.json',
    'data/transit/travel-times.bin',
  ]);
  const unexpectedData = result.files.find(
    ({ path }) => path.startsWith('data/') && !allowedDataPaths.has(path),
  );
  if (unexpectedData !== undefined) {
    throw new Error(
      `Packed package contains unexpected runtime data ${unexpectedData.path}.`,
    );
  }
}
