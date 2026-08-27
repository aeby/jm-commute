import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  parseTransitPlacesJson,
  type TransitPlace,
} from '../src/transit/places';
import type {
  TransitPlaceServiceProfile,
  TransitPlaceServiceProfileDataset,
} from '../src/transit/service-profiles';
import type { TransitStop } from '../src/transit/stops';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const TRANSIT_PLACES_RELATIVE_PATH =
  'data/processed/transit-places.json';
const SERVICE_PROFILES_RELATIVE_PATH =
  'data/processed/transit-place-service-profiles.json';
const TRANSIT_STOPS_RELATIVE_PATH =
  'data/processed/transit-stops.json';

export const DEFAULT_LOCALITIES_FILE_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);

const TRANSIT_PLACES_PATH = resolve(
  PROJECT_ROOT,
  TRANSIT_PLACES_RELATIVE_PATH,
);
const SERVICE_PROFILES_PATH = resolve(
  PROJECT_ROOT,
  SERVICE_PROFILES_RELATIVE_PATH,
);
const TRANSIT_STOPS_PATH = resolve(
  PROJECT_ROOT,
  TRANSIT_STOPS_RELATIVE_PATH,
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalidProfile = (index: number, message: string): never => {
  throw new Error(
    `Invalid service profile at index ${index} in ${SERVICE_PROFILES_RELATIVE_PATH}: ${message}.`,
  );
};

const parseMetadataString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new Error(
      `${SERVICE_PROFILES_RELATIVE_PATH} field "${field}" must be a string.`,
    );
  }
  return value;
};

const parseProfileCount = (
  profile: Readonly<Record<string, unknown>>,
  field: keyof Omit<TransitPlaceServiceProfile, 'placeId'>,
  index: number,
): number => {
  const count = profile[field];
  if (typeof count !== 'number') {
    return invalidProfile(index, `"${field}" must be a number`);
  }
  return count;
};

const parseServiceProfileDatasetJson = (
  json: string,
): TransitPlaceServiceProfileDataset => {
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

  const { serviceDate, windowStart, windowEnd, profiles } = value;
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
    serviceDate: parseMetadataString(serviceDate, 'serviceDate'),
    windowStart: parseMetadataString(windowStart, 'windowStart'),
    windowEnd: parseMetadataString(windowEnd, 'windowEnd'),
    profiles: parsedProfiles,
  };
};

export const readUtf8Input = async (
  path: string,
  description: string,
): Promise<string> => {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${description} at "${path}": ${message}`, {
      cause: error,
    });
  }
};

export const loadTransitCandidateInputs = async (): Promise<{
  readonly places: readonly TransitPlace[];
  readonly profileDataset: TransitPlaceServiceProfileDataset;
}> => {
  const [placesJson, profilesJson] = await Promise.all([
    readUtf8Input(TRANSIT_PLACES_PATH, 'processed transit-place JSON'),
    readUtf8Input(
      SERVICE_PROFILES_PATH,
      'processed transit-place service-profile JSON',
    ),
  ]);

  return {
    places: parseTransitPlacesJson(
      placesJson,
      TRANSIT_PLACES_RELATIVE_PATH,
    ),
    profileDataset: parseServiceProfileDatasetJson(profilesJson),
  };
};

export const loadTransitStopsInput = async (): Promise<
  readonly TransitStop[]
> => {
  const json = await readUtf8Input(
    TRANSIT_STOPS_PATH,
    'processed transit-stop JSON',
  );
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Unable to parse ${TRANSIT_STOPS_RELATIVE_PATH} as JSON.`,
      { cause: error },
    );
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `${TRANSIT_STOPS_RELATIVE_PATH} must contain a JSON array.`,
    );
  }

  return value.map((entry, index): TransitStop => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid transit stop at index ${index}: expected an object.`);
    }
    const { id, name, latitude, longitude, kind, parentStationId } = entry;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`Invalid transit stop at index ${index}: invalid id.`);
    }
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`Invalid transit stop at index ${index}: invalid name.`);
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error(
        `Invalid transit stop at index ${index}: coordinates must be finite.`,
      );
    }
    if (kind !== 'STOP_OR_PLATFORM' && kind !== 'STATION') {
      throw new Error(`Invalid transit stop at index ${index}: unsupported kind.`);
    }
    if (parentStationId !== undefined && typeof parentStationId !== 'string') {
      throw new Error(
        `Invalid transit stop at index ${index}: parentStationId must be a string.`,
      );
    }
    return {
      id,
      name,
      latitude: latitude as number,
      longitude: longitude as number,
      kind,
      ...(parentStationId === undefined ? {} : { parentStationId }),
    };
  });
};
