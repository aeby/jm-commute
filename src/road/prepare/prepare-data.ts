import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
  inspectRoadNetworkFiles,
  requireNonemptyFile,
  sha256File,
  type RoadNetworkFiles,
} from './files';
import { serializeRoadPreparedDataManifest } from './manifest';
import type {
  OsrmPreparationConfig,
  RoadPreparedDataManifest,
} from './types';

export interface PrepareDataOptions {
  readonly osmPbfPath: string;
  readonly outputDirectory: string;
  readonly osrm: OsrmPreparationConfig;
}

export interface PrepareDataResult extends RoadNetworkFiles {
  readonly manifest: RoadPreparedDataManifest;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function assertSafeOutputDirectory(outputDirectory: string): void {
  const absolute = resolve(outputDirectory);
  if (absolute === dirname(absolute)) {
    throw new Error('Prepared road-network directory must have a safe parent.');
  }
}

function runCommand(
  command: string,
  arguments_: readonly string[],
  description: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', (error) => {
      reject(new Error(`Unable to start ${description}.`, { cause: error }));
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const result = signal === null ? `exit code ${code}` : `signal ${signal}`;
      reject(new Error(`${description} failed with ${result}.`));
    });
  });
}

function dockerUserArguments(): readonly string[] {
  return typeof process.getuid === 'function' &&
    typeof process.getgid === 'function'
    ? ['--user', `${process.getuid()}:${process.getgid()}`]
    : [];
}

async function promoteDirectory(
  stagingDirectory: string,
  outputDirectory: string,
): Promise<void> {
  const backupDirectory = resolve(
    dirname(outputDirectory),
    `.road-network-backup-${randomUUID()}`,
  );
  let previousMoved = false;

  try {
    try {
      await rename(outputDirectory, backupDirectory);
      previousMoved = true;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
    await rename(stagingDirectory, outputDirectory);
  } catch (error) {
    if (previousMoved) {
      await rm(outputDirectory, { recursive: true, force: true });
      await rename(backupDirectory, outputDirectory);
    }
    throw error;
  }

  if (previousMoved) {
    await rm(backupDirectory, { recursive: true, force: true });
  }
}

/** Builds the one persisted OSRM dataset used by the road compiler. */
export async function prepareData(
  options: PrepareDataOptions,
): Promise<PrepareDataResult> {
  assertSafeOutputDirectory(options.outputDirectory);
  await requireNonemptyFile(options.osmPbfPath, 'OpenStreetMap PBF');
  const sourcePbfSha256 = await sha256File(options.osmPbfPath);
  const outputDirectory = resolve(options.outputDirectory);
  const outputParent = dirname(outputDirectory);
  await mkdir(outputParent, { recursive: true });
  const stagingDirectory = resolve(
    outputParent,
    `.road-network-${process.pid}-${randomUUID()}`,
  );
  await mkdir(stagingDirectory);

  const containerInputPath = `/input/${basename(options.osmPbfPath)}`;
  const containerOutputPath = `/data/${options.osrm.datasetBasename}`;
  const dockerArguments = (
    osrmArguments: readonly string[],
    includeInput: boolean,
  ): readonly string[] => [
    'run',
    '--rm',
    ...dockerUserArguments(),
    ...(includeInput
      ? [
          '--mount',
          `type=bind,source=${dirname(resolve(options.osmPbfPath))},target=/input,readonly`,
        ]
      : []),
    '--mount',
    `type=bind,source=${stagingDirectory},target=/data`,
    options.osrm.image,
    ...osrmArguments,
  ];

  try {
    await runCommand(
      'docker',
      dockerArguments(
        [
          'osrm-extract',
          '--profile',
          `/opt/${options.osrm.profile}`,
          '--output',
          containerOutputPath,
          containerInputPath,
        ],
        true,
      ),
      'OSRM extraction',
    );
    await runCommand(
      'docker',
      dockerArguments(['osrm-contract', containerOutputPath], false),
      'OSRM contraction',
    );

    await Promise.all(
      ['cnbg', 'cnbg_to_ebg'].map((suffix) =>
        unlink(
          resolve(
            stagingDirectory,
            `${options.osrm.datasetBasename}.${suffix}`,
          ),
        ).catch((error: unknown) => {
          if (!isMissingPathError(error)) {
            throw error;
          }
        }),
      ),
    );
    const networkFiles = await inspectRoadNetworkFiles(
      stagingDirectory,
      options.osrm.datasetBasename,
    );
    const sourcePbfSha256AfterBuild = await sha256File(options.osmPbfPath);
    if (sourcePbfSha256AfterBuild !== sourcePbfSha256) {
      throw new Error(
        'OpenStreetMap PBF changed while the road network was built.',
      );
    }

    const manifest: RoadPreparedDataManifest = {
      roadGraph: {
        sourcePbfSha256,
        osrmVersion: options.osrm.version,
        profile: options.osrm.profile,
        algorithm: options.osrm.algorithm,
      },
    };
    await writeFile(
      resolve(stagingDirectory, 'manifest.json'),
      serializeRoadPreparedDataManifest(manifest),
      'utf8',
    );
    await promoteDirectory(stagingDirectory, outputDirectory);
    return { ...networkFiles, manifest };
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}
