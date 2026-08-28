import { createHash } from 'node:crypto';

import {
  CAR_TRAVEL_TIME_MATRIX_SCHEMA_VERSION,
  calculateTravelTimeMatrixCellCount,
  parseCarTravelTimeMatrixManifest,
  UNREACHABLE_TRAVEL_MINUTES,
  type CarRoadGraphMetadata,
  type CarTravelTimeMatrixManifest,
} from './travel-time-matrix-format';
import type { CarLocalityRoadAnchorsFile } from './locality-road-anchors-file';
import {
  decodeTravelMinutesLittleEndian,
  type CarTravelTimeMatrixLookup,
} from './travel-time-matrix';

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

function parseSha256(value: unknown, source: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(
      `Invalid anchors SHA-256 in ${source}: expected a lowercase SHA-256 digest.`,
    );
  }
  return value;
}

function bytesSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
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
