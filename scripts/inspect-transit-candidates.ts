import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  LocalityResolver,
  parseLocalitiesCsv,
} from '../src/localities';
import {
  findNearbyTransitPlaces,
  type NearbyTransitPlacesOptions,
  type TransitPlace,
} from '../src/transit/places';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const TRANSIT_PLACES_RELATIVE_PATH =
  'data/processed/transit-places.json';
const TRANSIT_PLACES_PATH = resolve(
  PROJECT_ROOT,
  TRANSIT_PLACES_RELATIVE_PATH,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidPlace(index: number, message: string): never {
  throw new Error(
    `Invalid transit place at index ${index} in ${TRANSIT_PLACES_RELATIVE_PATH}: ${message}.`,
  );
}

function parseTransitPlacesJson(json: string): readonly TransitPlace[] {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to parse ${TRANSIT_PLACES_RELATIVE_PATH} as JSON: ${message}`,
      { cause: error },
    );
  }

  if (!Array.isArray(value)) {
    throw new Error(
      `${TRANSIT_PLACES_RELATIVE_PATH} must contain a JSON array.`,
    );
  }

  return value.map((entry, index): TransitPlace => {
    if (!isRecord(entry)) {
      return invalidPlace(index, 'expected an object');
    }

    const { id, name, latitude, longitude, stopIds } = entry;

    if (typeof id !== 'string' || id.trim().length === 0) {
      return invalidPlace(index, '"id" must be a non-empty string');
    }

    if (typeof name !== 'string' || name.trim().length === 0) {
      return invalidPlace(index, '"name" must be a non-empty string');
    }

    if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
      return invalidPlace(index, '"latitude" must be a finite number');
    }

    if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
      return invalidPlace(index, '"longitude" must be a finite number');
    }

    if (
      !Array.isArray(stopIds) ||
      !stopIds.every((stopId) => typeof stopId === 'string')
    ) {
      return invalidPlace(index, '"stopIds" must be an array of strings');
    }

    return { id, name, latitude, longitude, stopIds };
  });
}

async function readUtf8File(
  path: string,
  description: string,
): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${description} at "${path}": ${message}`, {
      cause: error,
    });
  }
}

function requireOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required option --${name}.`);
  }

  return value;
}

function parseLimit(value: string): number {
  const limit = Number(value);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('--limit must be a positive integer.');
  }

  return limit;
}

function parseMaxDistanceMeters(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.trim().length === 0) {
    throw new Error(
      '--max-distance-km must be a finite number greater than or equal to zero.',
    );
  }

  const kilometres = Number(value);
  const meters = kilometres * 1_000;

  if (
    !Number.isFinite(kilometres) ||
    kilometres < 0 ||
    !Number.isFinite(meters)
  ) {
    throw new Error(
      '--max-distance-km must be a finite number greater than or equal to zero.',
    );
  }

  return meters;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'localities-file': { type: 'string' },
      'postal-code': { type: 'string' },
      city: { type: 'string' },
      limit: { type: 'string', default: '10' },
      'max-distance-km': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });
  const localitiesFile = resolve(
    requireOption(values['localities-file'], 'localities-file'),
  );
  const postalCode = requireOption(values['postal-code'], 'postal-code');
  const city = requireOption(values.city, 'city');
  const maxResults = parseLimit(values.limit);
  const maxDistanceMeters = parseMaxDistanceMeters(
    values['max-distance-km'],
  );
  const localitiesCsv = await readUtf8File(
    localitiesFile,
    'locality CSV',
  );
  const localities = parseLocalitiesCsv(localitiesCsv);
  const locality = new LocalityResolver(localities).resolve({
    postalCode,
    city,
  });

  if (locality === undefined) {
    throw new Error(`Unable to resolve locality: ${postalCode} ${city}.`);
  }

  const placesJson = await readUtf8File(
    TRANSIT_PLACES_PATH,
    'processed transit-place JSON',
  );
  const places = parseTransitPlacesJson(placesJson);
  const options: NearbyTransitPlacesOptions = {
    maxResults,
    ...(maxDistanceMeters === undefined ? {} : { maxDistanceMeters }),
  };
  const candidates = findNearbyTransitPlaces(locality, places, options);

  if (candidates.length === 0) {
    const radiusDescription =
      maxDistanceMeters === undefined
        ? ''
        : ` within ${maxDistanceMeters / 1_000} km`;
    throw new Error(
      `No transit-place candidates found for ${locality.postalCode} ${locality.city}${radiusDescription}.`,
    );
  }

  console.log(`Locality: ${locality.postalCode} ${locality.city}`);
  console.log(`Coordinates: ${locality.latitude}, ${locality.longitude}`);

  candidates.forEach(({ place, distanceMeters }, index) => {
    console.log('');
    console.log(`${index + 1}. ${place.name}`);
    console.log(`   Distance: ${distanceMeters.toFixed(1)} m`);
    console.log(`   ID: ${place.id}`);
    console.log(`   Routing stop IDs: ${place.stopIds.length}`);
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
