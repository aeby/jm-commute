import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { COMMUTE_PACKAGE_DIRECTORY, PROJECT_ROOT } from './paths';
import { runCommand } from './run-command';

export interface NpmPackResult {
  readonly size: number;
  readonly unpackedSize: number;
  readonly shasum: string;
  readonly integrity: string;
  readonly tarballPath: string;
  readonly elapsedMilliseconds: number;
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
    throw new Error('npm pack returned unreadable JSON.', { cause: error });
  }
  const result = Array.isArray(value) ? value[0] : undefined;
  if (
    typeof result !== 'object' ||
    result === null ||
    typeof (result as Record<string, unknown>).filename !== 'string' ||
    typeof (result as Record<string, unknown>).size !== 'number' ||
    typeof (result as Record<string, unknown>).unpackedSize !== 'number' ||
    typeof (result as Record<string, unknown>).shasum !== 'string' ||
    typeof (result as Record<string, unknown>).integrity !== 'string'
  ) {
    throw new Error('npm pack returned an incompatible result.');
  }
  const record = result as Record<string, string | number>;
  return {
    size: record.size as number,
    unpackedSize: record.unpackedSize as number,
    shasum: record.shasum as string,
    integrity: record.integrity as string,
    tarballPath: resolve(outputDirectory, record.filename as string),
    elapsedMilliseconds,
  };
}

export async function createNpmPackageTarball(
  requestedOutputDirectory?: string,
): Promise<NpmPackResult> {
  const outputDirectory = requestedOutputDirectory === undefined
    ? await mkdtemp(resolve(tmpdir(), 'jobmate-commute-pack-'))
    : isAbsolute(requestedOutputDirectory)
      ? requestedOutputDirectory
      : resolve(PROJECT_ROOT, requestedOutputDirectory);
  await mkdir(outputDirectory, { recursive: true });

  const command = await runCommand(
    'npm',
    [
      'pack',
      '--json',
      '--offline',
      '--ignore-scripts',
      '--dry-run=false',
      '--pack-destination',
      outputDirectory,
      '--cache',
      resolve(outputDirectory, '.npm-cache'),
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
