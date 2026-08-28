import type { LocalityId } from '../../localities';
import {
  calculateTravelTimeMatrixCellCount,
  getTravelTimeMatrixCellIndex,
  MAX_TRAVEL_MINUTES,
  TRAVEL_TIME_MATRIX_BYTES_PER_CELL,
  UNREACHABLE_TRAVEL_MINUTES,
} from '../travel-time-matrix-format';

export interface MutableCarTravelTimeRowSlab {
  readonly sourceRowCount: number;
  readonly localityCount: number;
  readonly values: Uint16Array;
  readonly assigned: Uint8Array;
}

export interface CarDurationBlock {
  readonly destinationStartIndex: number;
  readonly destinationCount: number;
  readonly durationsSeconds: readonly (readonly (number | undefined)[])[];
}

function assertPositiveSafeInteger(value: number, description: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive safe integer.`);
  }
}

/** Conservatively converts OSRM seconds to whole minutes. */
export function durationSecondsToTravelMinutes(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error('Travel duration must be a nonnegative finite number.');
  }
  const travelMinutes = Math.ceil(durationSeconds / 60);
  if (travelMinutes > MAX_TRAVEL_MINUTES) {
    throw new Error(
      `Travel duration ${durationSeconds} seconds requires ${travelMinutes} minutes, exceeding the maximum valid value ${MAX_TRAVEL_MINUTES}.`,
    );
  }
  return travelMinutes;
}

function assertEncodedTravelMinutes(value: number, index: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > UNREACHABLE_TRAVEL_MINUTES
  ) {
    throw new Error(
      `Travel-time value at index ${index} must be an unsigned 16-bit integer.`,
    );
  }
}

/** Encodes every value explicitly as unsigned little-endian 16-bit data. */
export function encodeTravelMinutesLittleEndian(
  values: ArrayLike<number>,
): Uint8Array {
  const bytes = Buffer.alloc(values.length * TRAVEL_TIME_MATRIX_BYTES_PER_CELL);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    assertEncodedTravelMinutes(value, index);
    bytes.writeUInt16LE(value, index * TRAVEL_TIME_MATRIX_BYTES_PER_CELL);
  }
  return bytes;
}

/** Decodes unsigned little-endian 16-bit data without host-endian assumptions. */
export function decodeTravelMinutesLittleEndian(
  bytes: Uint8Array,
): Uint16Array {
  if (bytes.byteLength % TRAVEL_TIME_MATRIX_BYTES_PER_CELL !== 0) {
    throw new Error(
      `Travel-time binary byte length ${bytes.byteLength} is not divisible by ${TRAVEL_TIME_MATRIX_BYTES_PER_CELL}.`,
    );
  }
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Uint16Array(
    bytes.byteLength / TRAVEL_TIME_MATRIX_BYTES_PER_CELL,
  );
  for (let index = 0; index < values.length; index += 1) {
    values[index] = input.readUInt16LE(
      index * TRAVEL_TIME_MATRIX_BYTES_PER_CELL,
    );
  }
  return values;
}

export function createCarTravelTimeRowSlab(
  sourceRowCount: number,
  localityCount: number,
): MutableCarTravelTimeRowSlab {
  assertPositiveSafeInteger(sourceRowCount, 'Source-row count');
  assertPositiveSafeInteger(localityCount, 'Matrix locality count');
  if (sourceRowCount > localityCount) {
    throw new Error('Source-row count cannot exceed matrix locality count.');
  }
  const cellCount = sourceRowCount * localityCount;
  if (!Number.isSafeInteger(cellCount)) {
    throw new Error('Row-slab cell count exceeds JavaScript safe integers.');
  }
  return {
    sourceRowCount,
    localityCount,
    values: new Uint16Array(cellCount),
    assigned: new Uint8Array(cellCount),
  };
}

/**
 * Writes a destination block at its declared column offset. Completion order
 * therefore cannot affect the final row-slab bytes.
 */
export function writeCarDurationBlockToRowSlab(
  slab: MutableCarTravelTimeRowSlab,
  block: CarDurationBlock,
): void {
  if (
    !Number.isSafeInteger(block.destinationStartIndex) ||
    block.destinationStartIndex < 0
  ) {
    throw new Error('Destination start index must be a nonnegative integer.');
  }
  assertPositiveSafeInteger(
    block.destinationCount,
    'Destination-block count',
  );
  if (
    block.destinationStartIndex + block.destinationCount >
    slab.localityCount
  ) {
    throw new Error('Destination block extends beyond the matrix columns.');
  }
  if (block.durationsSeconds.length !== slab.sourceRowCount) {
    throw new Error(
      `Duration block has ${block.durationsSeconds.length} rows; expected ${slab.sourceRowCount}.`,
    );
  }

  for (let sourceOffset = 0; sourceOffset < slab.sourceRowCount; sourceOffset += 1) {
    const row = block.durationsSeconds[sourceOffset] as readonly (
      | number
      | undefined
    )[];
    if (row.length !== block.destinationCount) {
      throw new Error(
        `Duration block row ${sourceOffset} has ${row.length} columns; expected ${block.destinationCount}.`,
      );
    }
    for (
      let destinationOffset = 0;
      destinationOffset < block.destinationCount;
      destinationOffset += 1
    ) {
      const slabIndex =
        sourceOffset * slab.localityCount +
        block.destinationStartIndex +
        destinationOffset;
      if (slab.assigned[slabIndex] !== 0) {
        throw new Error(`Row-slab cell ${slabIndex} was assigned more than once.`);
      }
      const durationSeconds = row[destinationOffset];
      slab.values[slabIndex] =
        durationSeconds === undefined
          ? UNREACHABLE_TRAVEL_MINUTES
          : durationSecondsToTravelMinutes(durationSeconds);
      slab.assigned[slabIndex] = 1;
    }
  }
}

export function finalizeCarTravelTimeRowSlab(
  slab: MutableCarTravelTimeRowSlab,
  sourceStartIndex: number,
): Uint16Array {
  if (
    !Number.isSafeInteger(sourceStartIndex) ||
    sourceStartIndex < 0 ||
    sourceStartIndex + slab.sourceRowCount > slab.localityCount
  ) {
    throw new Error('Source block extends beyond the matrix rows.');
  }
  for (let index = 0; index < slab.assigned.length; index += 1) {
    if (slab.assigned[index] === 0) {
      throw new Error(`Row-slab cell ${index} was never assigned.`);
    }
  }
  for (let sourceOffset = 0; sourceOffset < slab.sourceRowCount; sourceOffset += 1) {
    const sourceIndex = sourceStartIndex + sourceOffset;
    slab.values[sourceOffset * slab.localityCount + sourceIndex] = 0;
  }
  return slab.values;
}

export interface CarTravelTimeMatrixLookup {
  readonly localityCount: number;
  readonly localityIds: readonly LocalityId[];
  readonly values: Uint16Array;
}

export function getMatrixTravelMinutes(
  matrix: CarTravelTimeMatrixLookup,
  fromLocalityId: LocalityId,
  toLocalityId: LocalityId,
): number | undefined {
  const originIndex = matrix.localityIds.indexOf(fromLocalityId);
  if (originIndex < 0) {
    throw new Error(`Unknown origin locality ID "${fromLocalityId}".`);
  }
  const destinationIndex = matrix.localityIds.indexOf(toLocalityId);
  if (destinationIndex < 0) {
    throw new Error(`Unknown destination locality ID "${toLocalityId}".`);
  }
  if (
    matrix.localityIds.length !== matrix.localityCount ||
    matrix.values.length !== calculateTravelTimeMatrixCellCount(matrix.localityCount)
  ) {
    throw new Error('Travel-time matrix lookup data has inconsistent dimensions.');
  }
  const value =
    matrix.values[
      getTravelTimeMatrixCellIndex(
        matrix.localityCount,
        originIndex,
        destinationIndex,
      )
    ] as number;
  return value === UNREACHABLE_TRAVEL_MINUTES ? undefined : value;
}
