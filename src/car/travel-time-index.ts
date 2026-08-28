import type { LocalityId, ReachableLocality } from '../localities';
import {
  calculateTravelTimeMatrixCellCount,
  getTravelTimeMatrixCellIndex,
  parseCarTravelTimeMatrixManifest,
  TRAVEL_TIME_MATRIX_BYTES_PER_CELL,
  UNREACHABLE_TRAVEL_MINUTES,
  type CarTravelTimeMatrixManifest,
} from './travel-time-matrix-format';

const carTravelTimeIndexBrand: unique symbol = Symbol(
  'CarTravelTimeIndex',
);

/** Opaque validated index over the generated directional car-time matrix. */
export interface CarTravelTimeIndex {
  readonly [carTravelTimeIndexBrand]: true;
}

export interface CarTravelTimeIndexDiagnostics {
  readonly nativeLittleEndian: boolean;
  readonly matrixBytesCopied: boolean;
  readonly matrixValuesByteLength: number;
  readonly localityIndexEntryCount: number;
}

interface CarTravelTimeIndexInternals {
  readonly localityCount: number;
  readonly localityIds: readonly LocalityId[];
  readonly localityIndexes: ReadonlyMap<LocalityId, number>;
  readonly values: Uint16Array;
  readonly matrixBytesCopied: boolean;
}

const internalsByIndex = new WeakMap<
  CarTravelTimeIndex,
  CarTravelTimeIndexInternals
>();

const NATIVE_LITTLE_ENDIAN = (() => {
  const probe = new Uint16Array([0x0102]);
  return new Uint8Array(probe.buffer)[0] === 0x02;
})();

function matrixByteView(matrixBytes: ArrayBuffer | Uint8Array): Uint8Array {
  if (matrixBytes instanceof Uint8Array) {
    return matrixBytes;
  }
  if (matrixBytes instanceof ArrayBuffer) {
    return new Uint8Array(matrixBytes);
  }
  throw new TypeError(
    'Car travel-time matrix bytes must be an ArrayBuffer or Uint8Array.',
  );
}

interface DecodedMatrixValues {
  readonly values: Uint16Array;
  readonly matrixBytesCopied: boolean;
}

function decodeMatrixValues(bytes: Uint8Array): DecodedMatrixValues {
  const valueCount = bytes.byteLength / TRAVEL_TIME_MATRIX_BYTES_PER_CELL;
  if (NATIVE_LITTLE_ENDIAN && bytes.byteOffset % Uint16Array.BYTES_PER_ELEMENT === 0) {
    return {
      values: new Uint16Array(bytes.buffer, bytes.byteOffset, valueCount),
      matrixBytesCopied: false,
    };
  }

  const values = new Uint16Array(valueCount);
  for (let index = 0; index < valueCount; index += 1) {
    const byteIndex = index * TRAVEL_TIME_MATRIX_BYTES_PER_CELL;
    values[index] =
      (bytes[byteIndex] as number) |
      ((bytes[byteIndex + 1] as number) << 8);
  }
  return { values, matrixBytesCopied: true };
}

function requireInternals(
  index: CarTravelTimeIndex,
): CarTravelTimeIndexInternals {
  const internals = internalsByIndex.get(index);
  if (internals === undefined) {
    throw new TypeError('Invalid car travel-time index.');
  }
  return internals;
}

function requireLocalityIndex(
  internals: CarTravelTimeIndexInternals,
  localityId: LocalityId,
): number {
  const index = internals.localityIndexes.get(localityId);
  if (index === undefined) {
    throw new Error(`Unknown car-routing locality: ${localityId}`);
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
 * Creates a browser-safe lookup over a validated matrix envelope and bytes.
 *
 * On little-endian hosts, an aligned input is viewed without copying. Callers
 * must therefore treat the supplied bytes as immutable after construction.
 * Unaligned views and non-little-endian hosts use an explicit little-endian
 * decoded copy.
 *
 * SHA-256 verification is intentionally the Node loader's responsibility;
 * this synchronous browser boundary validates structure, length, and diagonal.
 */
export function createCarTravelTimeIndex(
  manifest: CarTravelTimeMatrixManifest,
  matrixBytes: ArrayBuffer | Uint8Array,
): CarTravelTimeIndex {
  const validatedManifest = parseCarTravelTimeMatrixManifest(
    manifest,
    'car travel-time index manifest',
  );
  const bytes = matrixByteView(matrixBytes);
  if (bytes.byteLength !== validatedManifest.matrixByteLength) {
    throw new Error(
      `Car travel-time matrix has ${bytes.byteLength} bytes; manifest expects ${validatedManifest.matrixByteLength}.`,
    );
  }
  const expectedValueCount = calculateTravelTimeMatrixCellCount(
    validatedManifest.localityCount,
  );
  const { values, matrixBytesCopied } = decodeMatrixValues(bytes);
  if (values.length !== expectedValueCount) {
    throw new Error(
      `Car travel-time matrix decoded to ${values.length} values; expected ${expectedValueCount}.`,
    );
  }
  for (let index = 0; index < validatedManifest.localityCount; index += 1) {
    const diagonalValue =
      values[
        getTravelTimeMatrixCellIndex(
          validatedManifest.localityCount,
          index,
          index,
        )
      ];
    if (diagonalValue !== 0) {
      throw new Error(
        `Car travel-time matrix self cell for "${validatedManifest.localityIds[index]}" must be 0; received ${diagonalValue}.`,
      );
    }
  }

  const localityIds = validatedManifest.localityIds;
  const localityIndexes = new Map(
    localityIds.map((localityId, index) => [localityId, index]),
  );
  const opaqueIndex = Object.freeze({
    [carTravelTimeIndexBrand]: true as const,
  });
  internalsByIndex.set(opaqueIndex, {
    localityCount: validatedManifest.localityCount,
    localityIds,
    localityIndexes,
    values,
    matrixBytesCopied,
  });
  return opaqueIndex;
}

export function getCarTravelTimeIndexDiagnostics(
  index: CarTravelTimeIndex,
): CarTravelTimeIndexDiagnostics {
  const internals = requireInternals(index);
  return Object.freeze({
    nativeLittleEndian: NATIVE_LITTLE_ENDIAN,
    matrixBytesCopied: internals.matrixBytesCopied,
    matrixValuesByteLength: internals.values.byteLength,
    localityIndexEntryCount: internals.localityIndexes.size,
  });
}

export function getCarTravelMinutes(
  index: CarTravelTimeIndex,
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
  return value === UNREACHABLE_TRAVEL_MINUTES ? undefined : value;
}

export function getReachableLocalitiesByCar(
  index: CarTravelTimeIndex,
  originLocalityId: LocalityId,
  maxTravelMinutes: number,
): readonly ReachableLocality[] {
  if (!Number.isSafeInteger(maxTravelMinutes) || maxTravelMinutes < 0) {
    throw new Error(
      'Maximum car travel minutes must be a nonnegative safe integer.',
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
      travelMinutes !== UNREACHABLE_TRAVEL_MINUTES &&
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
