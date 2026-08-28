import type { LocalityId, ReachableLocality } from '../localities';
import {
  calculateTravelTimeMatrixCellCount,
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  getTravelTimeMatrixCellIndex,
  parseTravelTimeMatrixDescriptor,
  UNAVAILABLE_TRAVEL_TIME,
} from './travel-time-matrix-format';

const travelTimeIndexBrand: unique symbol = Symbol('TravelTimeIndex');

/** Opaque validated index over a directional runtime commute matrix. */
export interface TravelTimeIndex {
  readonly [travelTimeIndexBrand]: true;
}

export interface TravelTimeIndexDiagnostics {
  readonly matrixBytesCopied: false;
  readonly matrixValuesByteLength: number;
  readonly localityIndexEntryCount: number;
}

interface TravelTimeIndexInternals {
  readonly localityCount: number;
  readonly localityIds: readonly LocalityId[];
  readonly localityIndexes: ReadonlyMap<LocalityId, number>;
  readonly values: Uint8Array;
}

const internalsByIndex = new WeakMap<
  TravelTimeIndex,
  TravelTimeIndexInternals
>();

function matrixByteView(matrixBytes: ArrayBuffer | Uint8Array): Uint8Array {
  if (matrixBytes instanceof Uint8Array) {
    return matrixBytes;
  }
  if (matrixBytes instanceof ArrayBuffer) {
    return new Uint8Array(matrixBytes);
  }
  throw new TypeError(
    'Travel-time matrix bytes must be an ArrayBuffer or Uint8Array.',
  );
}

function requireInternals(index: TravelTimeIndex): TravelTimeIndexInternals {
  const internals = internalsByIndex.get(index);
  if (internals === undefined) {
    throw new TypeError('Invalid travel-time index.');
  }
  return internals;
}

function requireLocalityIndex(
  internals: TravelTimeIndexInternals,
  localityId: LocalityId,
): number {
  const index = internals.localityIndexes.get(localityId);
  if (index === undefined) {
    throw new Error(`Unknown travel-time locality: ${localityId}`);
  }
  return index;
}

function compareReachableLocalities(
  left: ReachableLocality,
  right: ReachableLocality,
): number {
  const durationDifference = left.travelMinutes - right.travelMinutes;
  if (durationDifference !== 0) {
    return durationDifference;
  }
  return left.localityId < right.localityId
    ? -1
    : left.localityId > right.localityId
      ? 1
      : 0;
}

/**
 * Creates a platform-neutral, zero-copy lookup over validated matrix bytes.
 *
 * The caller must treat the supplied bytes as immutable after construction.
 * SHA-256 authentication remains the responsibility of platform-specific
 * loaders; this injected-data boundary validates the descriptor, byte length,
 * value domain, and diagonal.
 */
export function createTravelTimeIndex(
  descriptor: unknown,
  matrixBytes: ArrayBuffer | Uint8Array,
): TravelTimeIndex {
  const validatedDescriptor = parseTravelTimeMatrixDescriptor(
    descriptor,
    'travel-time index descriptor',
  );
  const values = matrixByteView(matrixBytes);
  if (values.byteLength !== validatedDescriptor.matrixByteLength) {
    throw new Error(
      `Travel-time matrix has ${values.byteLength} bytes; descriptor expects ${validatedDescriptor.matrixByteLength}.`,
    );
  }

  const expectedValueCount = calculateTravelTimeMatrixCellCount(
    validatedDescriptor.localityCount,
  );
  if (values.length !== expectedValueCount) {
    throw new Error(
      `Travel-time matrix contains ${values.length} values; expected ${expectedValueCount}.`,
    );
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    if (
      value > COMMUTE_MATRIX_MAX_TRAVEL_MINUTES &&
      value !== UNAVAILABLE_TRAVEL_TIME
    ) {
      throw new Error(
        `Travel-time matrix cell ${index} contains reserved schema-v1 value ${value}; expected 0–${COMMUTE_MATRIX_MAX_TRAVEL_MINUTES} or ${UNAVAILABLE_TRAVEL_TIME}.`,
      );
    }
  }
  for (let index = 0; index < validatedDescriptor.localityCount; index += 1) {
    const diagonalValue =
      values[
        getTravelTimeMatrixCellIndex(
          validatedDescriptor.localityCount,
          index,
          index,
        )
      ];
    if (diagonalValue !== 0) {
      throw new Error(
        `Travel-time matrix self cell for "${validatedDescriptor.localityIds[index]}" must be 0; received ${diagonalValue}.`,
      );
    }
  }

  const localityIds = validatedDescriptor.localityIds;
  const localityIndexes = new Map(
    localityIds.map((localityId, index) => [localityId, index]),
  );
  const opaqueIndex = Object.freeze({
    [travelTimeIndexBrand]: true as const,
  });
  internalsByIndex.set(opaqueIndex, {
    localityCount: validatedDescriptor.localityCount,
    localityIds,
    localityIndexes,
    values,
  });
  return opaqueIndex;
}

/** @internal Diagnostics for publication and runtime benchmark tooling. */
export function getTravelTimeIndexDiagnostics(
  index: TravelTimeIndex,
): TravelTimeIndexDiagnostics {
  const internals = requireInternals(index);
  return Object.freeze({
    matrixBytesCopied: false,
    matrixValuesByteLength: internals.values.byteLength,
    localityIndexEntryCount: internals.localityIndexes.size,
  });
}

export function getTravelMinutes(
  index: TravelTimeIndex,
  fromLocalityId: LocalityId,
  toLocalityId: LocalityId,
): number | undefined {
  const internals = requireInternals(index);
  const originIndex = requireLocalityIndex(internals, fromLocalityId);
  const destinationIndex = requireLocalityIndex(internals, toLocalityId);
  const value =
    internals.values[
      getTravelTimeMatrixCellIndex(
        internals.localityCount,
        originIndex,
        destinationIndex,
      )
    ] as number;
  return value === UNAVAILABLE_TRAVEL_TIME ? undefined : value;
}

export function getReachableLocalities(
  index: TravelTimeIndex,
  originLocalityId: LocalityId,
  maxTravelMinutes: number,
): readonly ReachableLocality[] {
  if (
    !Number.isSafeInteger(maxTravelMinutes) ||
    maxTravelMinutes < 0 ||
    maxTravelMinutes > COMMUTE_MATRIX_MAX_TRAVEL_MINUTES
  ) {
    throw new Error(
      `Maximum travel minutes must be a safe integer between 0 and ${COMMUTE_MATRIX_MAX_TRAVEL_MINUTES}.`,
    );
  }
  const internals = requireInternals(index);
  const originIndex = requireLocalityIndex(internals, originLocalityId);
  const rowOffset = getTravelTimeMatrixCellIndex(
    internals.localityCount,
    originIndex,
    0,
  );
  const reachable: ReachableLocality[] = [];
  for (
    let destinationIndex = 0;
    destinationIndex < internals.localityCount;
    destinationIndex += 1
  ) {
    const travelMinutes = internals.values[rowOffset + destinationIndex] as number;
    if (
      travelMinutes !== UNAVAILABLE_TRAVEL_TIME &&
      travelMinutes <= maxTravelMinutes
    ) {
      reachable.push({
        localityId: internals.localityIds[destinationIndex] as LocalityId,
        travelMinutes,
      });
    }
  }
  return reachable.toSorted(compareReachableLocalities);
}
