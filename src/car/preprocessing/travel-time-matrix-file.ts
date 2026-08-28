import { createHash } from 'node:crypto';

import type { LocalityId } from '../../localities';
import type {
  CarLocalityRoadAnchorsFile,
  CarRoadGraphMetadata,
} from './locality-road-anchors-file';
import {
  calculateTravelTimeMatrixByteLength,
  calculateTravelTimeMatrixCellCount,
  decodeTravelMinutesLittleEndian,
  type CarTravelTimeMatrixLookup,
  UNREACHABLE_TRAVEL_MINUTES,
} from './travel-time-matrix';

export const CAR_TRAVEL_TIME_MATRIX_SCHEMA_VERSION = 1;

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

export interface LoadedCarTravelTimeMatrix
  extends CarTravelTimeMatrixLookup {
  readonly manifest: CarTravelTimeMatrixManifest;
}

export interface CreateCarTravelTimeMatrixManifestOptions {
  readonly anchorsFile: CarLocalityRoadAnchorsFile;
  readonly anchorsSha256: string;
  readonly matrixBytes: Uint8Array;
}

export interface CarTravelTimeMatrixAnchorProvenance {
  readonly anchorsFile: CarLocalityRoadAnchorsFile;
  readonly anchorsSha256: string;
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

function parseSha256(value: unknown, source: string, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalid(source, path, 'expected a lowercase SHA-256 digest');
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

function bytesSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseCarTravelTimeMatrixManifest(
  value: unknown,
  source = 'value',
): CarTravelTimeMatrixManifest {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  requireExactKeys(
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
    source,
    '$',
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
    roadGraph: parseRoadGraph(value.roadGraph, source),
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

function assertRoadGraphMatches(
  actual: CarRoadGraphMetadata,
  expected: CarRoadGraphMetadata,
): void {
  for (const key of [
    'sourcePbfSha256',
    'osrmVersion',
    'profile',
    'algorithm',
  ] as const) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `Travel-time matrix roadGraph.${key} "${actual[key]}" does not match anchors "${expected[key]}".`,
      );
    }
  }
}

export function validateCarTravelTimeMatrixAgainstAnchors(
  manifest: CarTravelTimeMatrixManifest,
  provenance: CarTravelTimeMatrixAnchorProvenance,
): void {
  const anchorsSha256 = parseSha256(
    provenance.anchorsSha256,
    'anchor provenance',
    'anchorsSha256',
  );
  if (manifest.anchorsSha256 !== anchorsSha256) {
    throw new Error(
      `Travel-time matrix anchor SHA-256 ${manifest.anchorsSha256} does not match ${anchorsSha256}.`,
    );
  }
  if (manifest.localityCount !== provenance.anchorsFile.localityCount) {
    throw new Error(
      `Travel-time matrix has ${manifest.localityCount} localities, but anchors have ${provenance.anchorsFile.localityCount}.`,
    );
  }
  if (
    manifest.localityInputSha256 !==
    provenance.anchorsFile.localityInputSha256
  ) {
    throw new Error(
      'Travel-time matrix locality-input fingerprint does not match the anchors.',
    );
  }
  assertRoadGraphMatches(manifest.roadGraph, provenance.anchorsFile.roadGraph);
  for (let index = 0; index < manifest.localityCount; index += 1) {
    const expectedId = provenance.anchorsFile.anchors[index]?.localityId;
    if (manifest.localityIds[index] !== expectedId) {
      throw new Error(
        `Travel-time matrix locality ID at index ${index} is "${manifest.localityIds[index]}"; expected anchor ID "${expectedId ?? 'missing'}".`,
      );
    }
  }
}

export function createCarTravelTimeMatrixManifest(
  options: CreateCarTravelTimeMatrixManifestOptions,
): CarTravelTimeMatrixManifest {
  const file = options.anchorsFile;
  const manifest = parseCarTravelTimeMatrixManifest(
    {
      schemaVersion: CAR_TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
      localityCount: file.localityCount,
      localityIds: file.anchors.map(({ localityId }) => localityId),
      layout: 'ROW_MAJOR',
      valueEncoding: 'UINT16_LE',
      unit: 'MINUTES',
      unreachableValue: UNREACHABLE_TRAVEL_MINUTES,
      rounding: 'CEIL_SECONDS_TO_MINUTES',
      anchorsSha256: options.anchorsSha256,
      localityInputSha256: file.localityInputSha256,
      roadGraph: file.roadGraph,
      matrixByteLength: options.matrixBytes.byteLength,
      matrixSha256: bytesSha256(options.matrixBytes),
    },
    'generated car travel-time matrix manifest',
  );
  validateCarTravelTimeMatrixAgainstAnchors(manifest, {
    anchorsFile: file,
    anchorsSha256: options.anchorsSha256,
  });
  return manifest;
}

export function serializeCarTravelTimeMatrixManifest(
  manifest: CarTravelTimeMatrixManifest,
): string {
  const validated = parseCarTravelTimeMatrixManifest(
    manifest,
    'car travel-time matrix manifest serialization input',
  );
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function loadCarTravelTimeMatrix(
  manifest: CarTravelTimeMatrixManifest,
  matrixBytes: Uint8Array,
  provenance: CarTravelTimeMatrixAnchorProvenance,
): LoadedCarTravelTimeMatrix {
  const validatedManifest = parseCarTravelTimeMatrixManifest(
    manifest,
    'car travel-time matrix load input',
  );
  validateCarTravelTimeMatrixAgainstAnchors(validatedManifest, provenance);
  if (matrixBytes.byteLength !== validatedManifest.matrixByteLength) {
    throw new Error(
      `Travel-time matrix binary has ${matrixBytes.byteLength} bytes; manifest expects ${validatedManifest.matrixByteLength}.`,
    );
  }
  const actualSha256 = bytesSha256(matrixBytes);
  if (actualSha256 !== validatedManifest.matrixSha256) {
    throw new Error(
      `Travel-time matrix binary SHA-256 ${actualSha256} does not match manifest ${validatedManifest.matrixSha256}.`,
    );
  }
  const values = decodeTravelMinutesLittleEndian(matrixBytes);
  if (
    values.length !==
    calculateTravelTimeMatrixCellCount(validatedManifest.localityCount)
  ) {
    throw new Error('Travel-time matrix decoded to an unexpected cell count.');
  }
  for (let index = 0; index < validatedManifest.localityCount; index += 1) {
    const diagonalValue =
      values[index * validatedManifest.localityCount + index];
    if (diagonalValue !== 0) {
      throw new Error(
        `Travel-time matrix self cell for "${validatedManifest.localityIds[index]}" must be 0; received ${diagonalValue}.`,
      );
    }
  }
  return {
    manifest: validatedManifest,
    localityCount: validatedManifest.localityCount,
    localityIds: validatedManifest.localityIds,
    values,
  };
}
