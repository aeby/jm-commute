import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createCarTravelTimeIndex,
  type CarTravelTimeIndex,
} from '../car/index.js';
import {
  parseCarTravelTimeManifestJson,
  type CarTravelTimeManifest,
} from '../car/travel-time-manifest.js';
import {
  createTransitTravelTimeIndex,
  type TransitTravelTimeIndex,
} from '../transit/index.js';
import {
  parseTransitTravelTimeManifestJson,
  type TransitTravelTimeManifest,
} from '../transit/travel-time-manifest.js';
import type { TravelTimeMatrixDescriptor } from '../travel-time-matrix/travel-time-matrix-format.js';

export interface LoadTravelTimeIndexOptions {
  readonly runtimeDataDirectory: string;
}

interface RuntimeManifest {
  readonly matrix: TravelTimeMatrixDescriptor;
}

export interface LoadedTravelTimeData<TManifest, TIndex> {
  readonly manifest: TManifest;
  readonly index: TIndex;
}

async function readManifest(mode: string, path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${mode} manifest at "${path}".`, {
      cause: error,
    });
  }
}

async function readMatrix(mode: string, path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`Unable to read ${mode} matrix at "${path}".`, {
      cause: error,
    });
  }
}

async function loadTravelTimeData<TManifest extends RuntimeManifest, TIndex>(
  mode: string,
  options: LoadTravelTimeIndexOptions,
  parseManifest: (json: string, source: string) => TManifest,
  createIndex: (manifest: TManifest, bytes: Uint8Array) => TIndex,
): Promise<LoadedTravelTimeData<TManifest, TIndex>> {
  if (options.runtimeDataDirectory.trim().length === 0) {
    throw new TypeError(
      `${mode[0]?.toUpperCase()}${mode.slice(1)} runtime data directory must be a nonempty path.`,
    );
  }
  const manifestPath = resolve(options.runtimeDataDirectory, 'manifest.json');
  const matrixPath = resolve(options.runtimeDataDirectory, 'travel-times.bin');
  const manifestJson = await readManifest(mode, manifestPath);
  const manifest = parseManifest(
    manifestJson,
    `${mode} travel-time manifest "${manifestPath}"`,
  );
  const matrixBytes = await readMatrix(mode, matrixPath);

  if (matrixBytes.byteLength !== manifest.matrix.matrixByteLength) {
    throw new Error(
      `${mode[0]?.toUpperCase()}${mode.slice(1)} travel-time matrix at ` +
        `"${matrixPath}" has ${matrixBytes.byteLength} bytes; manifest expects ` +
        `${manifest.matrix.matrixByteLength}.`,
    );
  }
  const actualSha256 = createHash('sha256').update(matrixBytes).digest('hex');
  if (actualSha256 !== manifest.matrix.matrixSha256) {
    throw new Error(
      `${mode[0]?.toUpperCase()}${mode.slice(1)} travel-time matrix at ` +
        `"${matrixPath}" has SHA-256 ${actualSha256}; manifest expects ` +
        `${manifest.matrix.matrixSha256}.`,
    );
  }

  return { manifest, index: createIndex(manifest, matrixBytes) };
}

export async function loadCarTravelTimeData(
  options: LoadTravelTimeIndexOptions,
): Promise<LoadedTravelTimeData<CarTravelTimeManifest, CarTravelTimeIndex>> {
  return await loadTravelTimeData(
    'car',
    options,
    parseCarTravelTimeManifestJson,
    createCarTravelTimeIndex,
  );
}

export async function loadTransitTravelTimeData(
  options: LoadTravelTimeIndexOptions,
): Promise<
  LoadedTravelTimeData<TransitTravelTimeManifest, TransitTravelTimeIndex>
> {
  return await loadTravelTimeData(
    'transit',
    options,
    parseTransitTravelTimeManifestJson,
    createTransitTravelTimeIndex,
  );
}

/** Root preprocessing/diagnostic loader; intentionally not package-exported. */
export async function loadCarTravelTimeIndex(
  options: LoadTravelTimeIndexOptions,
): Promise<CarTravelTimeIndex> {
  return (await loadCarTravelTimeData(options)).index;
}

/** Root preprocessing/diagnostic loader; intentionally not package-exported. */
export async function loadTransitTravelTimeIndex(
  options: LoadTravelTimeIndexOptions,
): Promise<TransitTravelTimeIndex> {
  return (await loadTransitTravelTimeData(options)).index;
}
