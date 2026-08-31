import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseLocalitiesJson } from './localities.js';
import { createCommuteRuntime, type CommuteRuntime } from './runtime.js';

export type { CommuteRuntime } from './runtime.js';

async function readPackagedFile(path: string): Promise<Buffer> {
  const url = new URL(path, import.meta.url);
  try {
    return await readFile(url);
  } catch (error) {
    throw new Error(
      `Unable to read packaged commute data at "${fileURLToPath(url)}".`,
      { cause: error },
    );
  }
}

/** Loads the package-relative locality index and its two finished matrices. */
export async function loadCommuteRuntime(): Promise<CommuteRuntime> {
  const [localityBytes, publicTransportMatrix, roadMatrix] = await Promise.all([
    readPackagedFile('../data/localities.json'),
    readPackagedFile('../data/public_transport/travel-times.bin'),
    readPackagedFile('../data/road/travel-times.bin'),
  ]);

  return createCommuteRuntime({
    localities: parseLocalitiesJson(
      localityBytes.toString('utf8'),
      'packaged localities.json',
    ),
    publicTransportMatrix,
    roadMatrix,
  });
}
