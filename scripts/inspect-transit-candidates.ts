import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  LocalityResolver,
  parseLocalitiesCsv,
} from '../src/localities';
import {
  selectTransitPlaceCandidates,
  TRANSIT_CANDIDATE_SELECTION,
  type SelectTransitPlaceCandidatesOptions,
} from '../src/transit/candidates';
import type { TransitPlace } from '../src/transit/places';
import type {
  TransitPlaceServiceProfile,
  TransitPlaceServiceProfileDataset,
} from '../src/transit/service-profiles';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const TRANSIT_PLACES_RELATIVE_PATH =
  'data/processed/transit-places.json';
const TRANSIT_PLACES_PATH = resolve(
  PROJECT_ROOT,
  TRANSIT_PLACES_RELATIVE_PATH,
);
const SERVICE_PROFILES_RELATIVE_PATH =
  'data/processed/transit-place-service-profiles.json';
const SERVICE_PROFILES_PATH = resolve(
  PROJECT_ROOT,
  SERVICE_PROFILES_RELATIVE_PATH,
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

function invalidProfile(index: number, message: string): never {
  throw new Error(
    `Invalid service profile at index ${index} in ${SERVICE_PROFILES_RELATIVE_PATH}: ${message}.`,
  );
}

function parseMetadataString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string') {
    throw new Error(
      `${SERVICE_PROFILES_RELATIVE_PATH} field "${field}" must be a string.`,
    );
  }

  return value;
}

function parseProfileCount(
  profile: Readonly<Record<string, unknown>>,
  field: keyof Omit<TransitPlaceServiceProfile, 'placeId'>,
  index: number,
): number {
  const count = profile[field];

  if (typeof count !== 'number') {
    return invalidProfile(index, `"${field}" must be a number`);
  }

  return count;
}

function parseServiceProfileDatasetJson(
  json: string,
): TransitPlaceServiceProfileDataset {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to parse ${SERVICE_PROFILES_RELATIVE_PATH} as JSON: ${message}`,
      { cause: error },
    );
  }

  if (!isRecord(value)) {
    throw new Error(
      `${SERVICE_PROFILES_RELATIVE_PATH} must contain a JSON object.`,
    );
  }

  const { serviceDate, departureTime, windowStart, windowEnd, profiles } =
    value;
  const parsedServiceDate = parseMetadataString(serviceDate, 'serviceDate');
  const parsedDepartureTime = parseMetadataString(
    departureTime,
    'departureTime',
  );
  const parsedWindowStart = parseMetadataString(windowStart, 'windowStart');
  const parsedWindowEnd = parseMetadataString(windowEnd, 'windowEnd');

  if (!Array.isArray(profiles)) {
    throw new Error(
      `${SERVICE_PROFILES_RELATIVE_PATH} field "profiles" must be an array.`,
    );
  }

  const parsedProfiles = profiles.map((profile, index) => {
    if (!isRecord(profile)) {
      return invalidProfile(index, 'expected an object');
    }

    const { placeId } = profile;

    if (typeof placeId !== 'string') {
      return invalidProfile(index, '"placeId" must be a string');
    }

    return {
      placeId,
      departureCount: parseProfileCount(profile, 'departureCount', index),
      routeCount: parseProfileCount(profile, 'routeCount', index),
      railDepartureCount: parseProfileCount(
        profile,
        'railDepartureCount',
        index,
      ),
      railRouteCount: parseProfileCount(profile, 'railRouteCount', index),
    };
  });

  return {
    serviceDate: parsedServiceDate,
    departureTime: parsedDepartureTime,
    windowStart: parsedWindowStart,
    windowEnd: parsedWindowEnd,
    profiles: parsedProfiles,
  };
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

function parseFallbackCandidateCount(value: string | undefined):
  | number
  | undefined {
  if (value === undefined) {
    return undefined;
  }

  const count = Number(value);

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('--fallback-candidate-count must be a positive integer.');
  }

  return count;
}

function parseMaxAccessDistanceMeters(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.trim().length === 0) {
    throw new Error(
      '--max-access-distance-meters must be a finite number greater than or equal to zero.',
    );
  }

  const meters = Number(value);

  if (!Number.isFinite(meters) || meters < 0) {
    throw new Error(
      '--max-access-distance-meters must be a finite number greater than or equal to zero.',
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
      'max-access-distance-meters': { type: 'string' },
      'fallback-candidate-count': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });
  const localitiesFile = resolve(
    requireOption(values['localities-file'], 'localities-file'),
  );
  const postalCode = requireOption(values['postal-code'], 'postal-code');
  const city = requireOption(values.city, 'city');
  const maxAccessDistanceMeters = parseMaxAccessDistanceMeters(
    values['max-access-distance-meters'],
  );
  const fallbackCandidateCount = parseFallbackCandidateCount(
    values['fallback-candidate-count'],
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
  const profileDatasetJson = await readUtf8File(
    SERVICE_PROFILES_PATH,
    'processed transit-place service-profile JSON',
  );
  const profileDataset = parseServiceProfileDatasetJson(profileDatasetJson);
  const options: SelectTransitPlaceCandidatesOptions = {
    ...(maxAccessDistanceMeters === undefined
      ? {}
      : { maxAccessDistanceMeters }),
    ...(fallbackCandidateCount === undefined
      ? {}
      : { fallbackCandidateCount }),
  };
  const selection = selectTransitPlaceCandidates(
    locality,
    places,
    profileDataset,
    options,
  );
  const configuredAccessDistanceMeters =
    maxAccessDistanceMeters ??
    TRANSIT_CANDIDATE_SELECTION.maxAccessDistanceMeters;

  if (selection.candidates.length === 0) {
    throw new Error(
      `No transit-place candidates found for ${locality.postalCode} ${locality.city}.`,
    );
  }

  console.log(`Locality: ${locality.postalCode} ${locality.city}`);
  console.log(`Coordinates: ${locality.latitude}, ${locality.longitude}`);
  console.log(`Selection mode: ${selection.mode}`);
  console.log(
    `Maximum access distance: ${configuredAccessDistanceMeters} m`,
  );
  console.log(`Candidates: ${selection.candidates.length}`);

  if (selection.mode === 'NEAREST_FALLBACK') {
    console.log('');
    console.warn(
      `No transit place exists within ${configuredAccessDistanceMeters} m.`,
    );
    console.warn(
      `Showing the ${selection.candidates.length} geographically nearest fallback candidates.`,
    );
    console.warn('Alternative access may be required.');
  }

  selection.candidates.forEach(
    ({ place, profile, distanceMeters }, index) => {
      console.log('');
      console.log(`${index + 1}. ${place.name}`);
      console.log(`   Distance: ${distanceMeters.toFixed(1)} m`);
      console.log(`   Routes: ${profile.routeCount}`);
      console.log(`   Departures: ${profile.departureCount}`);
      console.log(`   Rail routes: ${profile.railRouteCount}`);
      console.log(`   Rail departures: ${profile.railDepartureCount}`);
      console.log(`   ID: ${place.id}`);
    },
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
