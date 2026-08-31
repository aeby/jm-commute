import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseLocalitiesCsv } from '../../localities/node';
import {
  inspectRoadNetworkFiles,
  requireNonemptyFile,
  sha256File,
} from './files';
import { parseRoadPreparedDataManifestJson } from './manifest';
import type {
  OsrmPreparationConfig,
  PreparedData,
} from './types';

export interface LoadPreparedDataOptions {
  readonly osmPbfPath: string;
  readonly localitiesPath: string;
  readonly networkDirectory: string;
  readonly osrm: OsrmPreparationConfig;
}

/** Loads and authenticates the complete input required by `buildNetwork`. */
export async function loadPreparedData(
  options: LoadPreparedDataOptions,
): Promise<PreparedData> {
  await Promise.all([
    requireNonemptyFile(options.osmPbfPath, 'OpenStreetMap PBF'),
    inspectRoadNetworkFiles(
      options.networkDirectory,
      options.osrm.datasetBasename,
    ),
  ]);
  const [manifestJson, localitiesCsv, sourcePbfSha256] = await Promise.all([
    readFile(resolve(options.networkDirectory, 'manifest.json'), 'utf8'),
    readFile(options.localitiesPath, 'utf8'),
    sha256File(options.osmPbfPath),
  ]);
  const manifest = parseRoadPreparedDataManifestJson(
    manifestJson,
    resolve(options.networkDirectory, 'manifest.json'),
  );
  const expectedRoadGraph = {
    sourcePbfSha256,
    osrmVersion: options.osrm.version,
    profile: options.osrm.profile,
    algorithm: options.osrm.algorithm,
  } as const;
  for (const key of [
    'sourcePbfSha256',
    'osrmVersion',
    'profile',
    'algorithm',
  ] as const) {
    if (manifest.roadGraph[key] !== expectedRoadGraph[key]) {
      throw new Error(
        `Prepared road-network ${key} ${JSON.stringify(manifest.roadGraph[key])} does not match the current input ${JSON.stringify(expectedRoadGraph[key])}. Rebuild the prepared road data.`,
      );
    }
  }

  const localities = parseLocalitiesCsv(localitiesCsv).toSorted((left, right) =>
    left.localityId < right.localityId
      ? -1
      : left.localityId > right.localityId
        ? 1
        : 0,
  );
  if (localities.length === 0) {
    throw new Error('The canonical locality input is empty.');
  }
  return { localities, roadGraph: manifest.roadGraph };
}
