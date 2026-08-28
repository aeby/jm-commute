import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createTransitTravelTimeIndex,
  type TransitTravelTimeIndex,
} from './travel-time-index';
import { parseTransitTravelTimeManifestJson } from './travel-time-manifest';

export interface LoadTransitTravelTimeIndexOptions {
  readonly runtimeDataDirectory: string;
}

async function readManifest(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read transit travel-time manifest at "${path}".`,
      { cause: error },
    );
  }
}

async function readMatrix(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(
      `Unable to read transit travel-time matrix at "${path}".`,
      { cause: error },
    );
  }
}

/** Authenticates generated transit artifacts before constructing the index. */
export async function loadTransitTravelTimeIndex(
  options: LoadTransitTravelTimeIndexOptions,
): Promise<TransitTravelTimeIndex> {
  if (options.runtimeDataDirectory.trim().length === 0) {
    throw new TypeError(
      'Transit runtime data directory must be a nonempty path.',
    );
  }
  const manifestPath = resolve(options.runtimeDataDirectory, 'manifest.json');
  const matrixPath = resolve(options.runtimeDataDirectory, 'travel-times.bin');
  const manifestJson = await readManifest(manifestPath);
  const manifest = parseTransitTravelTimeManifestJson(
    manifestJson,
    `transit travel-time manifest "${manifestPath}"`,
  );
  const matrixBytes = await readMatrix(matrixPath);
  if (matrixBytes.byteLength !== manifest.matrix.matrixByteLength) {
    throw new Error(
      `Transit travel-time matrix at "${matrixPath}" has ` +
        `${matrixBytes.byteLength} bytes; manifest expects ` +
        `${manifest.matrix.matrixByteLength}.`,
    );
  }
  const actualSha256 = createHash('sha256').update(matrixBytes).digest('hex');
  if (actualSha256 !== manifest.matrix.matrixSha256) {
    throw new Error(
      `Transit travel-time matrix at "${matrixPath}" has SHA-256 ` +
        `${actualSha256}; manifest expects ${manifest.matrix.matrixSha256}.`,
    );
  }
  return createTransitTravelTimeIndex(manifest, matrixBytes);
}
