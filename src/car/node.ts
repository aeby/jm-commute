import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createCarTravelTimeIndex,
  type CarTravelTimeIndex,
} from './travel-time-index';
import { parseCarTravelTimeManifestJson } from './travel-time-manifest';

export interface LoadCarTravelTimeIndexOptions {
  readonly runtimeDataDirectory: string;
}

async function readManifest(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read car travel-time manifest at "${path}".`, {
      cause: error,
    });
  }
}

async function readMatrix(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`Unable to read car travel-time matrix at "${path}".`, {
      cause: error,
    });
  }
}

/**
 * Loads and authenticates generated car-routing artifacts in Node.js before
 * constructing the platform-neutral runtime index.
 */
export async function loadCarTravelTimeIndex(
  options: LoadCarTravelTimeIndexOptions,
): Promise<CarTravelTimeIndex> {
  if (options.runtimeDataDirectory.trim().length === 0) {
    throw new TypeError('Car runtime data directory must be a nonempty path.');
  }
  const manifestPath = resolve(options.runtimeDataDirectory, 'manifest.json');
  const matrixPath = resolve(options.runtimeDataDirectory, 'travel-times.bin');
  const manifestJson = await readManifest(manifestPath);
  const manifest = parseCarTravelTimeManifestJson(
    manifestJson,
    `car travel-time manifest "${manifestPath}"`,
  );
  const matrixBytes = await readMatrix(matrixPath);

  if (matrixBytes.byteLength !== manifest.matrix.matrixByteLength) {
    throw new Error(
      `Car travel-time matrix at "${matrixPath}" has ${matrixBytes.byteLength} bytes; manifest expects ${manifest.matrix.matrixByteLength}.`,
    );
  }

  const actualSha256 = createHash('sha256').update(matrixBytes).digest('hex');
  if (actualSha256 !== manifest.matrix.matrixSha256) {
    throw new Error(
      `Car travel-time matrix at "${matrixPath}" has SHA-256 ${actualSha256}; manifest expects ${manifest.matrix.matrixSha256}.`,
    );
  }

  return createCarTravelTimeIndex(manifest, matrixBytes);
}
