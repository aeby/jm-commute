import {
  MAX_TRAVEL_MINUTES,
  UNAVAILABLE_TRAVEL_TIME,
} from '@commute-internal/matrix';

import type { RoadDurationTable } from '../network';

export interface MutableTravelTimeBlock {
  readonly originCount: number;
  readonly localityCount: number;
  readonly values: Uint8Array;
  readonly assigned: Uint8Array;
}

/** Rounds upward and applies the shared four-hour runtime horizon. */
export function encodeRoadDuration(durationSeconds: number | undefined): number {
  if (durationSeconds === undefined) {
    return UNAVAILABLE_TRAVEL_TIME;
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error('Road duration must be a nonnegative finite number.');
  }
  const minutes = Math.ceil(durationSeconds / 60);
  return minutes <= MAX_TRAVEL_MINUTES
    ? minutes
    : UNAVAILABLE_TRAVEL_TIME;
}

export function createTravelTimeBlock(
  originCount: number,
  localityCount: number,
): MutableTravelTimeBlock {
  if (!Number.isSafeInteger(originCount) || originCount <= 0) {
    throw new RangeError('Road matrix origin count must be positive.');
  }
  if (
    !Number.isSafeInteger(localityCount) ||
    localityCount <= 0 ||
    originCount > localityCount
  ) {
    throw new RangeError('Road matrix locality count is invalid.');
  }
  const cellCount = originCount * localityCount;
  if (!Number.isSafeInteger(cellCount)) {
    throw new RangeError('Road matrix block is too large.');
  }
  return {
    originCount,
    localityCount,
    values: new Uint8Array(cellCount).fill(UNAVAILABLE_TRAVEL_TIME),
    assigned: new Uint8Array(cellCount),
  };
}

export function writeDurationTable(
  block: MutableTravelTimeBlock,
  destinationStartIndex: number,
  destinationCount: number,
  table: RoadDurationTable,
): void {
  if (
    !Number.isSafeInteger(destinationStartIndex) ||
    destinationStartIndex < 0 ||
    !Number.isSafeInteger(destinationCount) ||
    destinationCount <= 0 ||
    destinationStartIndex + destinationCount > block.localityCount
  ) {
    throw new RangeError('Road matrix destination block is invalid.');
  }
  if (table.durationsSeconds.length !== block.originCount) {
    throw new Error(
      `OSRM table has ${table.durationsSeconds.length} rows; expected ${block.originCount}.`,
    );
  }

  for (
    let originOffset = 0;
    originOffset < block.originCount;
    originOffset += 1
  ) {
    const row = table.durationsSeconds[originOffset] as readonly (
      | number
      | undefined
    )[];
    if (row.length !== destinationCount) {
      throw new Error(
        `OSRM table row ${originOffset} has ${row.length} columns; expected ${destinationCount}.`,
      );
    }
    for (
      let destinationOffset = 0;
      destinationOffset < destinationCount;
      destinationOffset += 1
    ) {
      const index =
        originOffset * block.localityCount +
        destinationStartIndex +
        destinationOffset;
      if (block.assigned[index] !== 0) {
        throw new Error(`Road matrix block cell ${index} was assigned twice.`);
      }
      block.values[index] = encodeRoadDuration(row[destinationOffset]);
      block.assigned[index] = 1;
    }
  }
}

export function finalizeTravelTimeBlock(
  block: MutableTravelTimeBlock,
  originStartIndex: number,
): Uint8Array {
  if (
    !Number.isSafeInteger(originStartIndex) ||
    originStartIndex < 0 ||
    originStartIndex + block.originCount > block.localityCount
  ) {
    throw new RangeError('Road matrix origin block is invalid.');
  }
  const missingIndex = block.assigned.indexOf(0);
  if (missingIndex >= 0) {
    throw new Error(`Road matrix block cell ${missingIndex} was not assigned.`);
  }
  for (let offset = 0; offset < block.originCount; offset += 1) {
    block.values[offset * block.localityCount + originStartIndex + offset] = 0;
  }
  return block.values;
}
