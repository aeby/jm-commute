import type { LocalityId } from '../../localities';

export const CAR_TRAVEL_TIME_MATRIX_SCHEMA_VERSION = 1;
export const UNREACHABLE_TRAVEL_MINUTES = 0xffff;
export const MAX_TRAVEL_MINUTES = UNREACHABLE_TRAVEL_MINUTES - 1;
export const TRAVEL_TIME_MATRIX_BYTES_PER_CELL = 2;

export interface CarRoadGraphMetadata {
  readonly sourcePbfSha256: string;
  readonly osrmVersion: string;
  readonly profile: 'car.lua';
  readonly algorithm: 'ch';
}

export interface CarTravelTimeMatrixManifest {
  readonly schemaVersion: 1;
  readonly localityCount: number;
  readonly localityIds: readonly LocalityId[];
  readonly layout: 'ROW_MAJOR';
  readonly valueEncoding: 'UINT16_LE';
  readonly unit: 'MINUTES';
  readonly unreachableValue: 65535;
  readonly rounding: 'CEIL_SECONDS_TO_MINUTES';
  readonly anchorsSha256: string;
  readonly localityInputSha256: string;
  readonly roadGraph: CarRoadGraphMetadata;
  readonly matrixByteLength: number;
  readonly matrixSha256: string;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const OSRM_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid car travel-time matrix in ${source} at ${path}: ${detail}.`,
  );
}

/** @internal Shared only by the strict generated car-data parsers. */
export function requireExactCarDataKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  onInvalidDetail: (detail: string) => never,
): void {
  const actualKeys = Object.keys(value);
  const actual = new Set(actualKeys);
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((key) => !actual.has(key));
  if (missing.length > 0) {
    onInvalidDetail(`missing field(s) ${missing.join(', ')}`);
  }
  const unexpected = actualKeys.filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    onInvalidDetail(`unexpected field(s) ${unexpected.join(', ')}`);
  }
}

function parseSha256(value: unknown, source: string, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalid(source, path, 'expected a lowercase SHA-256 digest');
  }
  return value;
}

export function parseCarRoadGraphMetadata(
  value: unknown,
  source = 'value',
  path = 'roadGraph',
): CarRoadGraphMetadata {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid car road graph metadata in ${source} at ${path}: expected an object.`,
    );
  }
  requireExactCarDataKeys(
    value,
    ['sourcePbfSha256', 'osrmVersion', 'profile', 'algorithm'],
    (detail) => {
      throw new Error(
        `Invalid car road graph metadata in ${source} at ${path}: ${detail}.`,
      );
    },
  );
  if (
    typeof value.osrmVersion !== 'string' ||
    !OSRM_VERSION_PATTERN.test(value.osrmVersion)
  ) {
    throw new Error(
      `Invalid car road graph metadata in ${source} at ${path}.osrmVersion: expected a semantic version such as 26.8.0.`,
    );
  }
  if (value.profile !== 'car.lua') {
    throw new Error(
      `Invalid car road graph metadata in ${source} at ${path}.profile: expected "car.lua".`,
    );
  }
  if (value.algorithm !== 'ch') {
    throw new Error(
      `Invalid car road graph metadata in ${source} at ${path}.algorithm: expected "ch".`,
    );
  }
  if (
    typeof value.sourcePbfSha256 !== 'string' ||
    !SHA256_PATTERN.test(value.sourcePbfSha256)
  ) {
    throw new Error(
      `Invalid car road graph metadata in ${source} at ${path}.sourcePbfSha256: expected a lowercase SHA-256 digest.`,
    );
  }
  return {
    sourcePbfSha256: value.sourcePbfSha256,
    osrmVersion: value.osrmVersion,
    profile: value.profile,
    algorithm: value.algorithm,
  };
}

function parseLocalityIds(
  value: unknown,
  localityCount: number,
  source: string,
): readonly LocalityId[] {
  if (!Array.isArray(value)) {
    return invalid(source, 'localityIds', 'expected an array');
  }
  if (value.length !== localityCount) {
    return invalid(
      source,
      'localityIds',
      `has ${value.length} entries; expected ${localityCount}`,
    );
  }
  const localityIds: LocalityId[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const localityId = value[index];
    if (
      typeof localityId !== 'string' ||
      localityId.length === 0 ||
      localityId.trim() !== localityId
    ) {
      return invalid(
        source,
        `localityIds[${index}]`,
        'expected a nonempty canonical ID',
      );
    }
    if (seenIds.has(localityId)) {
      return invalid(
        source,
        `localityIds[${index}]`,
        `duplicate ID "${localityId}"`,
      );
    }
    seenIds.add(localityId);
    localityIds.push(localityId);
  }
  return localityIds;
}

function parsePositiveSafeInteger(
  value: unknown,
  source: string,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return invalid(source, path, 'expected a positive safe integer');
  }
  return value as number;
}

export function calculateTravelTimeMatrixCellCount(
  localityCount: number,
): number {
  if (!Number.isSafeInteger(localityCount) || localityCount <= 0) {
    throw new Error('Matrix locality count must be a positive safe integer.');
  }
  const cellCount = localityCount * localityCount;
  if (!Number.isSafeInteger(cellCount)) {
    throw new Error('Matrix cell count exceeds JavaScript safe integers.');
  }
  return cellCount;
}

export function calculateTravelTimeMatrixByteLength(
  localityCount: number,
): number {
  const byteLength =
    calculateTravelTimeMatrixCellCount(localityCount) *
    TRAVEL_TIME_MATRIX_BYTES_PER_CELL;
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error('Matrix byte length exceeds JavaScript safe integers.');
  }
  return byteLength;
}

/** Returns the cell index for the deterministic row-major matrix layout. */
export function getTravelTimeMatrixCellIndex(
  localityCount: number,
  originIndex: number,
  destinationIndex: number,
): number {
  calculateTravelTimeMatrixCellCount(localityCount);
  for (const [index, description] of [
    [originIndex, 'Origin'],
    [destinationIndex, 'Destination'],
  ] as const) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= localityCount) {
      throw new Error(
        `${description} index ${index} is outside the valid range 0–${localityCount - 1}.`,
      );
    }
  }
  return originIndex * localityCount + destinationIndex;
}

export function parseCarTravelTimeMatrixManifest(
  value: unknown,
  source = 'value',
): CarTravelTimeMatrixManifest {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  requireExactCarDataKeys(
    value,
    [
      'schemaVersion',
      'localityCount',
      'localityIds',
      'layout',
      'valueEncoding',
      'unit',
      'unreachableValue',
      'rounding',
      'anchorsSha256',
      'localityInputSha256',
      'roadGraph',
      'matrixByteLength',
      'matrixSha256',
    ],
    (detail) => invalid(source, '$', detail),
  );
  if (value.schemaVersion !== CAR_TRAVEL_TIME_MATRIX_SCHEMA_VERSION) {
    return invalid(source, 'schemaVersion', 'expected 1');
  }
  const localityCount = parsePositiveSafeInteger(
    value.localityCount,
    source,
    'localityCount',
  );
  const expectedByteLength = calculateTravelTimeMatrixByteLength(localityCount);
  if (value.layout !== 'ROW_MAJOR') {
    return invalid(source, 'layout', 'expected "ROW_MAJOR"');
  }
  if (value.valueEncoding !== 'UINT16_LE') {
    return invalid(source, 'valueEncoding', 'expected "UINT16_LE"');
  }
  if (value.unit !== 'MINUTES') {
    return invalid(source, 'unit', 'expected "MINUTES"');
  }
  if (value.unreachableValue !== UNREACHABLE_TRAVEL_MINUTES) {
    return invalid(
      source,
      'unreachableValue',
      `expected ${UNREACHABLE_TRAVEL_MINUTES}`,
    );
  }
  if (value.rounding !== 'CEIL_SECONDS_TO_MINUTES') {
    return invalid(
      source,
      'rounding',
      'expected "CEIL_SECONDS_TO_MINUTES"',
    );
  }
  if (value.matrixByteLength !== expectedByteLength) {
    return invalid(
      source,
      'matrixByteLength',
      `expected ${expectedByteLength} for ${localityCount} localities`,
    );
  }

  return {
    schemaVersion: CAR_TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
    localityCount,
    localityIds: parseLocalityIds(
      value.localityIds,
      localityCount,
      source,
    ),
    layout: value.layout,
    valueEncoding: value.valueEncoding,
    unit: value.unit,
    unreachableValue: value.unreachableValue,
    rounding: value.rounding,
    anchorsSha256: parseSha256(
      value.anchorsSha256,
      source,
      'anchorsSha256',
    ),
    localityInputSha256: parseSha256(
      value.localityInputSha256,
      source,
      'localityInputSha256',
    ),
    roadGraph: parseCarRoadGraphMetadata(value.roadGraph, source),
    matrixByteLength: expectedByteLength,
    matrixSha256: parseSha256(
      value.matrixSha256,
      source,
      'matrixSha256',
    ),
  };
}

export function parseCarTravelTimeMatrixManifestJson(
  json: string,
  source = 'car travel-time matrix manifest JSON',
): CarTravelTimeMatrixManifest {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${source}: ${message}`, { cause: error });
  }
  return parseCarTravelTimeMatrixManifest(value, source);
}
