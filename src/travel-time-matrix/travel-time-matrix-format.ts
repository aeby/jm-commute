import type { LocalityId } from '../localities';

export const TRAVEL_TIME_MATRIX_SCHEMA_VERSION = 1;

/**
 * Maximum duration represented by the canonical runtime datasets.
 *
 * Applications may impose a smaller product limit without changing this
 * transport-independent data capability.
 */
export const COMMUTE_MATRIX_MAX_TRAVEL_MINUTES = 240;

/** Outside the published horizon or otherwise unavailable. */
export const UNAVAILABLE_TRAVEL_TIME = 0xff;

export const TRAVEL_TIME_MATRIX_BYTES_PER_CELL = Uint8Array.BYTES_PER_ELEMENT;

export interface TravelTimeMatrixDescriptor {
  readonly schemaVersion: 1;
  readonly localityCount: number;
  readonly localityIds: readonly LocalityId[];
  readonly maxTravelMinutes: 240;
  readonly layout: 'ROW_MAJOR';
  readonly valueEncoding: 'UINT8';
  readonly unit: 'MINUTES';
  readonly unavailableValue: 255;
  readonly matrixByteLength: number;
  readonly matrixSha256: string;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid travel-time matrix descriptor in ${source} at ${path}: ${detail}.`,
  );
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  source: string,
): void {
  const actualKeys = Object.keys(value);
  const actual = new Set(actualKeys);
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((key) => !actual.has(key));
  if (missing.length > 0) {
    invalid(source, '$', `missing field(s) ${missing.join(', ')}`);
  }
  const unexpected = actualKeys.filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    invalid(source, '$', `unexpected field(s) ${unexpected.join(', ')}`);
  }
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
  return Object.freeze(localityIds);
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

export function parseTravelTimeMatrixDescriptor(
  value: unknown,
  source = 'value',
): TravelTimeMatrixDescriptor {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'localityCount',
      'localityIds',
      'maxTravelMinutes',
      'layout',
      'valueEncoding',
      'unit',
      'unavailableValue',
      'matrixByteLength',
      'matrixSha256',
    ],
    source,
  );

  if (value.schemaVersion !== TRAVEL_TIME_MATRIX_SCHEMA_VERSION) {
    return invalid(source, 'schemaVersion', 'expected 1');
  }
  const localityCount = parsePositiveSafeInteger(
    value.localityCount,
    source,
    'localityCount',
  );
  if (value.maxTravelMinutes !== COMMUTE_MATRIX_MAX_TRAVEL_MINUTES) {
    return invalid(
      source,
      'maxTravelMinutes',
      `expected ${COMMUTE_MATRIX_MAX_TRAVEL_MINUTES}`,
    );
  }
  if (value.layout !== 'ROW_MAJOR') {
    return invalid(source, 'layout', 'expected "ROW_MAJOR"');
  }
  if (value.valueEncoding !== 'UINT8') {
    return invalid(source, 'valueEncoding', 'expected "UINT8"');
  }
  if (value.unit !== 'MINUTES') {
    return invalid(source, 'unit', 'expected "MINUTES"');
  }
  if (value.unavailableValue !== UNAVAILABLE_TRAVEL_TIME) {
    return invalid(
      source,
      'unavailableValue',
      `expected ${UNAVAILABLE_TRAVEL_TIME}`,
    );
  }

  const expectedByteLength = calculateTravelTimeMatrixByteLength(localityCount);
  if (value.matrixByteLength !== expectedByteLength) {
    return invalid(
      source,
      'matrixByteLength',
      `expected ${expectedByteLength} for ${localityCount} localities`,
    );
  }
  if (
    typeof value.matrixSha256 !== 'string' ||
    !SHA256_PATTERN.test(value.matrixSha256)
  ) {
    return invalid(
      source,
      'matrixSha256',
      'expected a lowercase SHA-256 digest',
    );
  }

  return Object.freeze({
    schemaVersion: TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
    localityCount,
    localityIds: parseLocalityIds(value.localityIds, localityCount, source),
    maxTravelMinutes: COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
    layout: value.layout,
    valueEncoding: value.valueEncoding,
    unit: value.unit,
    unavailableValue: value.unavailableValue,
    matrixByteLength: expectedByteLength,
    matrixSha256: value.matrixSha256,
  });
}
