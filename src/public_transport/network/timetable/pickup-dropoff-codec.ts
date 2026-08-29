import type { PickupDropOffType } from '../../prepare/gtfs/types';
import type { PackedPickupDropOffEntry } from './types';

const BITS_PER_VALUE = 2;
const VALUE_MASK = 0b11;
const ENTRIES_PER_BYTE = 2;

const validateType = (
  value: number,
  fieldName: 'pickupType' | 'dropOffType',
): void => {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new RangeError(`${fieldName} must be an integer from 0 through 3`);
  }
};

const validateEntryIndex = (
  packed: Uint8Array,
  entryIndex: number,
): void => {
  if (!Number.isInteger(entryIndex) || entryIndex < 0) {
    throw new RangeError('entryIndex must be a nonnegative integer');
  }

  if (entryIndex >= packed.length * ENTRIES_PER_BYTE) {
    throw new RangeError(`entryIndex ${entryIndex} is outside the packed data`);
  }
};

export const packedPickupDropOffByteLength = (entryCount: number): number => {
  if (!Number.isInteger(entryCount) || entryCount < 0) {
    throw new RangeError('entryCount must be a nonnegative integer');
  }

  return Math.ceil(entryCount / ENTRIES_PER_BYTE);
};

/**
 * Packs one stop entry into the shared layout:
 *
 * bits 0-1 drop-off entry 0, bits 2-3 pickup entry 0,
 * bits 4-5 drop-off entry 1, bits 6-7 pickup entry 1.
 */
export const setPackedPickupDropOffEntry = (
  packed: Uint8Array,
  entryIndex: number,
  pickupType: PickupDropOffType,
  dropOffType: PickupDropOffType,
): void => {
  validateEntryIndex(packed, entryIndex);
  validateType(pickupType, 'pickupType');
  validateType(dropOffType, 'dropOffType');

  const byteIndex = entryIndex >> 1;
  const nibbleShift = (entryIndex & 1) * 4;
  const nibbleMask = 0b1111 << nibbleShift;
  const encodedNibble =
    (dropOffType | (pickupType << BITS_PER_VALUE)) << nibbleShift;
  const current = packed[byteIndex] ?? 0;
  packed[byteIndex] = (current & ~nibbleMask) | encodedNibble;
};

export const encodePickupDropOffTypes = (
  entries: readonly PackedPickupDropOffEntry[],
): Uint8Array => {
  const packed = new Uint8Array(
    packedPickupDropOffByteLength(entries.length),
  );

  entries.forEach((entry, entryIndex) => {
    setPackedPickupDropOffEntry(
      packed,
      entryIndex,
      entry.pickupType,
      entry.dropOffType,
    );
  });

  return packed;
};

export const getPackedPickupType = (
  packed: Uint8Array,
  entryIndex: number,
): PickupDropOffType => {
  validateEntryIndex(packed, entryIndex);
  const byte = packed[entryIndex >> 1] ?? 0;
  const shift = (entryIndex & 1) * 4 + BITS_PER_VALUE;
  return ((byte >> shift) & VALUE_MASK) as PickupDropOffType;
};

export const getPackedDropOffType = (
  packed: Uint8Array,
  entryIndex: number,
): PickupDropOffType => {
  validateEntryIndex(packed, entryIndex);
  const byte = packed[entryIndex >> 1] ?? 0;
  const shift = (entryIndex & 1) * 4;
  return ((byte >> shift) & VALUE_MASK) as PickupDropOffType;
};
