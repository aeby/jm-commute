import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Locality } from '../../packages/commute/src/localities.js';
import { matrixByteLength } from '../../packages/commute/src/matrix.js';
import { parseLocalitiesCsv } from '../../src/localities/node.js';
import {
  COMMUTE_PACKAGE_DATA_DIRECTORY,
  OFFICIAL_LOCALITIES_CSV_PATH,
  ROOT_RUNTIME_DATA_DIRECTORY,
} from './paths.js';

export const RUNTIME_MODES = ['public_transport', 'road'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export interface AssembleRuntimeDataOptions {
  readonly runtimeDataDirectory: string;
  readonly packageDataDirectory: string;
  readonly localitiesCsvPath: string;
}

export interface AssembledRuntimeData {
  readonly runtimeDataDirectory: string;
  readonly packageDataDirectory: string;
  readonly localityCount: number;
  readonly matrixByteLength: number;
}

function orderedLocalities(csv: string): readonly Locality[] {
  const localities = parseLocalitiesCsv(csv).toSorted((left, right) =>
    left.localityId < right.localityId
      ? -1
      : left.localityId > right.localityId
        ? 1
        : 0,
  );
  if (localities.length === 0) {
    throw new Error('The official locality input is empty.');
  }
  for (let index = 1; index < localities.length; index += 1) {
    if (localities[index - 1]?.localityId === localities[index]?.localityId) {
      throw new Error(`Duplicate locality ID "${localities[index]?.localityId}".`);
    }
  }
  return localities;
}

async function requireArtifact(
  directory: string,
  mode: RuntimeMode,
  expectedMatrixByteLength: number,
): Promise<void> {
  const manifestPath = resolve(directory, mode, 'manifest.json');
  const matrixPath = resolve(directory, mode, 'travel-times.bin');
  const [manifest, matrix] = await Promise.all([
    stat(manifestPath),
    stat(matrixPath),
  ]);
  if (!manifest.isFile() || !matrix.isFile()) {
    throw new Error(`${mode} runtime artifact must contain regular files.`);
  }
  if (matrix.size !== expectedMatrixByteLength) {
    throw new Error(
      `${mode} matrix has ${matrix.size} bytes; expected ${expectedMatrixByteLength}.`,
    );
  }
}

/** Assembles the locality index and copies the two finished matrix artifacts. */
export async function assembleRuntimeData(
  options: AssembleRuntimeDataOptions = {
    runtimeDataDirectory: ROOT_RUNTIME_DATA_DIRECTORY,
    packageDataDirectory: COMMUTE_PACKAGE_DATA_DIRECTORY,
    localitiesCsvPath: OFFICIAL_LOCALITIES_CSV_PATH,
  },
): Promise<AssembledRuntimeData> {
  const csv = await readFile(options.localitiesCsvPath, 'utf8');
  const localities = orderedLocalities(csv);
  const expectedMatrixByteLength = matrixByteLength(localities.length);
  await Promise.all(
    RUNTIME_MODES.map(async (mode) =>
      await requireArtifact(
        options.runtimeDataDirectory,
        mode,
        expectedMatrixByteLength,
      ),
    ),
  );

  const serializedLocalities = `${JSON.stringify(localities, null, 2)}\n`;
  await Promise.all([
    mkdir(options.runtimeDataDirectory, { recursive: true }),
    mkdir(options.packageDataDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      resolve(options.runtimeDataDirectory, 'localities.json'),
      serializedLocalities,
    ),
    writeFile(
      resolve(options.packageDataDirectory, 'localities.json'),
      serializedLocalities,
    ),
  ]);

  for (const mode of RUNTIME_MODES) {
    const source = resolve(options.runtimeDataDirectory, mode);
    const target = resolve(options.packageDataDirectory, mode);
    await mkdir(target, { recursive: true });
    await Promise.all([
      copyFile(resolve(source, 'manifest.json'), resolve(target, 'manifest.json')),
      copyFile(
        resolve(source, 'travel-times.bin'),
        resolve(target, 'travel-times.bin'),
      ),
      writeFile(resolve(target, '.gitkeep'), ''),
    ]);
  }

  return {
    runtimeDataDirectory: options.runtimeDataDirectory,
    packageDataDirectory: options.packageDataDirectory,
    localityCount: localities.length,
    matrixByteLength: expectedMatrixByteLength,
  };
}
