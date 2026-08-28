import type { CarLocalityInput } from './types';
import {
  createLocalityInputFingerprint,
  type CarLocalityRoadAnchor,
} from './locality-road-anchors';

export const CAR_LOCALITY_ROAD_ANCHORS_SCHEMA_VERSION = 1;

export interface CarRoadGraphMetadata {
  readonly sourcePbfSha256: string;
  readonly osrmVersion: string;
  readonly profile: 'car.lua';
  readonly algorithm: 'ch';
}

export interface CarLocalityRoadAnchorsFile {
  readonly schemaVersion: 1;
  readonly localityCount: number;
  readonly localityInputSha256: string;
  readonly roadGraph: CarRoadGraphMetadata;
  readonly anchors: readonly CarLocalityRoadAnchor[];
}

export interface CreateCarLocalityRoadAnchorsFileOptions {
  readonly localityInputs: readonly CarLocalityInput[];
  readonly anchors: readonly CarLocalityRoadAnchor[];
  readonly roadGraph: CarRoadGraphMetadata;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const OSRM_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid car locality road anchors in ${source} at ${path}: ${detail}.`,
  );
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  source: string,
  path: string,
): void {
  const actualKeys = Object.keys(value);
  const actual = new Set(actualKeys);
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((key) => !actual.has(key));
  if (missing.length > 0) {
    invalid(source, path, `missing field(s) ${missing.join(', ')}`);
  }
  const unexpected = actualKeys.filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    invalid(source, path, `unexpected field(s) ${unexpected.join(', ')}`);
  }
}

function parseSha256(
  value: unknown,
  source: string,
  path: string,
): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalid(source, path, 'expected a lowercase SHA-256 digest');
  }
  return value;
}

function parseCoordinate(
  value: unknown,
  coordinateName: 'latitude' | 'longitude',
  source: string,
  path: string,
): number {
  const minimum = coordinateName === 'latitude' ? -90 : -180;
  const maximum = coordinateName === 'latitude' ? 90 : 180;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid(
      source,
      path,
      `expected a finite ${coordinateName} from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function parseRoadGraph(
  value: unknown,
  source: string,
): CarRoadGraphMetadata {
  if (!isRecord(value)) {
    return invalid(source, 'roadGraph', 'expected an object');
  }
  requireExactKeys(
    value,
    ['sourcePbfSha256', 'osrmVersion', 'profile', 'algorithm'],
    source,
    'roadGraph',
  );
  if (
    typeof value.osrmVersion !== 'string' ||
    !OSRM_VERSION_PATTERN.test(value.osrmVersion)
  ) {
    return invalid(
      source,
      'roadGraph.osrmVersion',
      'expected a semantic version such as 26.8.0',
    );
  }
  if (value.profile !== 'car.lua') {
    return invalid(source, 'roadGraph.profile', 'expected "car.lua"');
  }
  if (value.algorithm !== 'ch') {
    return invalid(source, 'roadGraph.algorithm', 'expected "ch"');
  }
  return {
    sourcePbfSha256: parseSha256(
      value.sourcePbfSha256,
      source,
      'roadGraph.sourcePbfSha256',
    ),
    osrmVersion: value.osrmVersion,
    profile: value.profile,
    algorithm: value.algorithm,
  };
}

function parseAnchor(
  value: unknown,
  index: number,
  source: string,
): CarLocalityRoadAnchor {
  const path = `anchors[${index}]`;
  if (!isRecord(value)) {
    return invalid(source, path, 'expected an object');
  }
  requireExactKeys(
    value,
    ['localityId', 'latitude', 'longitude', 'snapDistanceMeters'],
    source,
    path,
  );
  if (
    typeof value.localityId !== 'string' ||
    value.localityId.length === 0 ||
    value.localityId.trim() !== value.localityId
  ) {
    return invalid(
      source,
      `${path}.localityId`,
      'expected a nonempty canonical ID',
    );
  }
  if (
    typeof value.snapDistanceMeters !== 'number' ||
    !Number.isFinite(value.snapDistanceMeters) ||
    value.snapDistanceMeters < 0
  ) {
    return invalid(
      source,
      `${path}.snapDistanceMeters`,
      'expected a nonnegative finite number',
    );
  }
  return {
    localityId: value.localityId,
    latitude: parseCoordinate(
      value.latitude,
      'latitude',
      source,
      `${path}.latitude`,
    ),
    longitude: parseCoordinate(
      value.longitude,
      'longitude',
      source,
      `${path}.longitude`,
    ),
    snapDistanceMeters: value.snapDistanceMeters,
  };
}

export function parseCarLocalityRoadAnchorsFile(
  value: unknown,
  source = 'value',
): CarLocalityRoadAnchorsFile {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'localityCount',
      'localityInputSha256',
      'roadGraph',
      'anchors',
    ],
    source,
    '$',
  );
  if (value.schemaVersion !== CAR_LOCALITY_ROAD_ANCHORS_SCHEMA_VERSION) {
    return invalid(source, 'schemaVersion', 'expected 1');
  }
  if (
    !Number.isSafeInteger(value.localityCount) ||
    (value.localityCount as number) <= 0
  ) {
    return invalid(source, 'localityCount', 'expected a positive integer');
  }
  if (!Array.isArray(value.anchors)) {
    return invalid(source, 'anchors', 'expected an array');
  }
  if (value.anchors.length !== value.localityCount) {
    return invalid(
      source,
      'localityCount',
      `declares ${String(value.localityCount)} but anchors has ${value.anchors.length} entries`,
    );
  }

  const anchors = value.anchors.map((anchor, index) =>
    parseAnchor(anchor, index, source),
  );
  const seenIds = new Set<string>();
  for (let index = 0; index < anchors.length; index += 1) {
    const localityId = anchors[index]?.localityId as string;
    if (seenIds.has(localityId)) {
      return invalid(
        source,
        `anchors[${index}].localityId`,
        `duplicate ID "${localityId}"`,
      );
    }
    seenIds.add(localityId);
    const previousId = anchors[index - 1]?.localityId;
    if (previousId !== undefined && previousId > localityId) {
      return invalid(
        source,
        `anchors[${index}].localityId`,
        `anchors must be in ascending locality-ID order after "${previousId}"`,
      );
    }
  }

  return {
    schemaVersion: CAR_LOCALITY_ROAD_ANCHORS_SCHEMA_VERSION,
    localityCount: value.localityCount as number,
    localityInputSha256: parseSha256(
      value.localityInputSha256,
      source,
      'localityInputSha256',
    ),
    roadGraph: parseRoadGraph(value.roadGraph, source),
    anchors,
  };
}

export function parseCarLocalityRoadAnchorsJson(
  json: string,
  source = 'car locality road anchors JSON',
): CarLocalityRoadAnchorsFile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${source}: ${message}`, { cause: error });
  }
  return parseCarLocalityRoadAnchorsFile(value, source);
}

export function validateCarLocalityRoadAnchorsAgainstInputs(
  file: CarLocalityRoadAnchorsFile,
  localityInputs: readonly CarLocalityInput[],
): void {
  if (file.localityCount !== localityInputs.length) {
    throw new Error(
      `Car locality road anchors contain ${file.localityCount} entries, but current locality inputs contain ${localityInputs.length}.`,
    );
  }
  const expectedFingerprint = createLocalityInputFingerprint(localityInputs);
  if (file.localityInputSha256 !== expectedFingerprint) {
    throw new Error(
      `Car locality road anchors fingerprint ${file.localityInputSha256} does not match current locality inputs ${expectedFingerprint}.`,
    );
  }
  const expectedIds = localityInputs
    .map(({ localityId }) => localityId)
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  for (let index = 0; index < expectedIds.length; index += 1) {
    if (file.anchors[index]?.localityId !== expectedIds[index]) {
      throw new Error(
        `Car locality road anchor at index ${index} has ID "${file.anchors[index]?.localityId ?? 'missing'}"; expected "${expectedIds[index]}".`,
      );
    }
  }
}

export function createCarLocalityRoadAnchorsFile(
  options: CreateCarLocalityRoadAnchorsFileOptions,
): CarLocalityRoadAnchorsFile {
  const anchors = options.anchors
    .map(({ localityId, latitude, longitude, snapDistanceMeters }) => ({
      localityId,
      latitude,
      longitude,
      snapDistanceMeters,
    }))
    .toSorted((left, right) =>
      left.localityId < right.localityId
        ? -1
        : left.localityId > right.localityId
          ? 1
          : 0,
    );
  const file = parseCarLocalityRoadAnchorsFile(
    {
      schemaVersion: CAR_LOCALITY_ROAD_ANCHORS_SCHEMA_VERSION,
      localityCount: anchors.length,
      localityInputSha256: createLocalityInputFingerprint(
        options.localityInputs,
      ),
      roadGraph: options.roadGraph,
      anchors,
    },
    'generated car locality road anchors',
  );
  validateCarLocalityRoadAnchorsAgainstInputs(file, options.localityInputs);
  return file;
}

export function serializeCarLocalityRoadAnchorsFile(
  file: CarLocalityRoadAnchorsFile,
): string {
  const validated = parseCarLocalityRoadAnchorsFile(
    file,
    'car locality road anchors serialization input',
  );
  return `${JSON.stringify(validated, null, 2)}\n`;
}
