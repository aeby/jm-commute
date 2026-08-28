import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createCommuteRuntime,
  type CommuteRuntime,
} from './internal/commute-runtime.js';
import {
  loadCarTravelTimeData,
  loadTransitTravelTimeData,
} from './internal/load-travel-time-data.js';
import {
  createLocalityCatalog,
  parseLocalityCatalogFileJson,
  serializeOrderedLocalityIds,
} from './localities/locality-catalog.js';

export type {
  CommuteModeRuntime,
  CommuteRuntime,
} from './internal/commute-runtime.js';

async function loadPackagedLocalityCatalog() {
  const catalogUrl = new URL('../data/localities.json', import.meta.url);
  let catalogJson: string;
  try {
    catalogJson = await readFile(catalogUrl, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read packaged locality catalog at "${fileURLToPath(catalogUrl)}".`,
      { cause: error },
    );
  }
  const catalogFile = parseLocalityCatalogFileJson(
    catalogJson,
    `packaged locality catalog "${fileURLToPath(catalogUrl)}"`,
  );
  const actualOrderedSha256 = createHash('sha256')
    .update(serializeOrderedLocalityIds(catalogFile.localities), 'utf8')
    .digest('hex');
  if (actualOrderedSha256 !== catalogFile.orderedLocalitySha256) {
    throw new Error(
      `Packaged locality catalog has ordered-locality SHA-256 ` +
        `${actualOrderedSha256}; catalog expects ` +
        `${catalogFile.orderedLocalitySha256}.`,
    );
  }
  return createLocalityCatalog(catalogFile);
}

/**
 * Loads and authenticates both runtime datasets bundled with this installed
 * package. Asset resolution is relative to the package, never process.cwd().
 */
export async function loadCommuteRuntime(): Promise<CommuteRuntime> {
  const [localities, car, transit] = await Promise.all([
    loadPackagedLocalityCatalog(),
    loadCarTravelTimeData({
      runtimeDataDirectory: fileURLToPath(
        new URL('../data/car/', import.meta.url),
      ),
    }),
    loadTransitTravelTimeData({
      runtimeDataDirectory: fileURLToPath(
        new URL('../data/transit/', import.meta.url),
      ),
    }),
  ]);

  return createCommuteRuntime(
    localities,
    car.index,
    transit.index,
    car.manifest.matrix.localityIds,
    transit.manifest.matrix.localityIds,
  );
}
