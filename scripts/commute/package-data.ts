import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Locality } from '@jobmate/commute';
import { matrixByteLength } from '@commute-internal/matrix';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  let localities = orderedLocalities(csv);
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

  const publicTransportManifestPath = resolve(
    options.runtimeDataDirectory,
    'public_transport',
    'manifest.json',
  );
  const manifest: unknown = JSON.parse(
    await readFile(publicTransportManifestPath, 'utf8'),
  );
  if (!isRecord(manifest) || !isRecord(manifest.source)) {
    throw new Error(`${publicTransportManifestPath} must contain a source object.`);
  }
  const { stationNames, ...source } = manifest.source;
  if (!Array.isArray(stationNames) || stationNames.length !== localities.length) {
    throw new Error(
      `${publicTransportManifestPath} stationNames must contain ${localities.length} entries in matrix order.`,
    );
  }
  localities = localities.map((locality, index) => {
    const name: unknown = stationNames[index];
    if (name === null) {
      return locality;
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`${publicTransportManifestPath} stationNames[${index}] must be a nonempty string or null.`);
    }
    return { ...locality, publicTransportStationName: name };
  });
  // Runtime reads names directly from localities.json. Keep only provenance
  // in the packaged manifest; the compiler's column is needed for reassembly.
  const publicTransportManifest = `${JSON.stringify({ ...manifest, source }, null, 2)}\n`;

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
    const sourceDirectory = resolve(options.runtimeDataDirectory, mode);
    const target = resolve(options.packageDataDirectory, mode);
    await mkdir(target, { recursive: true });
    await Promise.all([
      mode === 'public_transport'
        ? writeFile(resolve(target, 'manifest.json'), publicTransportManifest)
        : copyFile(resolve(sourceDirectory, 'manifest.json'), resolve(target, 'manifest.json')),
      copyFile(
        resolve(sourceDirectory, 'travel-times.bin'),
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
