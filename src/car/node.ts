import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createCarTravelTimeIndex,
  type CarTravelTimeIndex,
} from './travel-time-index';
import { parseCarTravelTimeMatrixManifestJson } from './travel-time-matrix-format';

export interface LoadCarTravelTimeIndexOptions {
  readonly manifestPath: string;
  readonly matrixPath: string;
}

export interface CarRuntimeDataPaths extends LoadCarTravelTimeIndexOptions {
  readonly directory: string;
}

/** Resolves the generated runtime artifacts from an explicit project root. */
export function resolveCarRuntimeDataPaths(
  projectRoot: string,
): CarRuntimeDataPaths {
  if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) {
    throw new TypeError('Car runtime data project root must be a nonempty path.');
  }
  const directory = resolve(projectRoot, 'data', 'runtime', 'car');
  return {
    directory,
    manifestPath: resolve(directory, 'manifest.json'),
    matrixPath: resolve(directory, 'travel-times.bin'),
  };
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
 * constructing the browser-safe runtime index.
 */
export async function loadCarTravelTimeIndex(
  options: LoadCarTravelTimeIndexOptions,
): Promise<CarTravelTimeIndex> {
  const manifestJson = await readManifest(options.manifestPath);
  const manifest = parseCarTravelTimeMatrixManifestJson(
    manifestJson,
    `car travel-time manifest "${options.manifestPath}"`,
  );
  const matrixBytes = await readMatrix(options.matrixPath);

  if (matrixBytes.byteLength !== manifest.matrixByteLength) {
    throw new Error(
      `Car travel-time matrix at "${options.matrixPath}" has ${matrixBytes.byteLength} bytes; manifest expects ${manifest.matrixByteLength}.`,
    );
  }

  const actualSha256 = createHash('sha256').update(matrixBytes).digest('hex');
  if (actualSha256 !== manifest.matrixSha256) {
    throw new Error(
      `Car travel-time matrix at "${options.matrixPath}" has SHA-256 ${actualSha256}; manifest expects ${manifest.matrixSha256}.`,
    );
  }

  return createCarTravelTimeIndex(manifest, matrixBytes);
}
