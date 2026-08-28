import { describe, expect, it } from 'vitest';

import type { PickupDropOffType } from '../../../gtfs';
import {
  encodePickupDropOffTypes,
  getPackedDropOffType,
  getPackedPickupType,
  packedPickupDropOffByteLength,
} from '../pickup-dropoff-codec';

const TYPES = [0, 1, 2, 3] as const;

describe('pickup/drop-off codec', () => {
  it('round-trips every pickup/drop-off combination in both packed nibbles', () => {
    for (const pickupType of TYPES) {
      for (const dropOffType of TYPES) {
        const packed = encodePickupDropOffTypes([
          { pickupType, dropOffType },
          { pickupType, dropOffType },
        ]);

        expect(getPackedPickupType(packed, 0)).toBe(pickupType);
        expect(getPackedDropOffType(packed, 0)).toBe(dropOffType);
        expect(getPackedPickupType(packed, 1)).toBe(pickupType);
        expect(getPackedDropOffType(packed, 1)).toBe(dropOffType);
      }
    }
  });

  it('packs an odd number of stop entries without corrupting the final entry', () => {
    const entries = [
      { pickupType: 0, dropOffType: 1 },
      { pickupType: 2, dropOffType: 3 },
      { pickupType: 3, dropOffType: 2 },
    ] as const;
    const packed = encodePickupDropOffTypes(entries);

    expect(packed).toHaveLength(2);
    entries.forEach((entry, index) => {
      expect(getPackedPickupType(packed, index)).toBe(entry.pickupType);
      expect(getPackedDropOffType(packed, index)).toBe(entry.dropOffType);
    });
  });

  it('packs even entries and several trip-sized sequences continuously', () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      pickupType: (index % 4) as PickupDropOffType,
      dropOffType: ((3 - index) & 3) as PickupDropOffType,
    }));
    const packed = encodePickupDropOffTypes(entries);

    expect(packed).toHaveLength(4);
    entries.forEach((entry, index) => {
      expect(getPackedPickupType(packed, index)).toBe(entry.pickupType);
      expect(getPackedDropOffType(packed, index)).toBe(entry.dropOffType);
    });
  });

  it('uses the documented bit layout for the first and second pairs', () => {
    const packed = encodePickupDropOffTypes([
      { pickupType: 2, dropOffType: 1 },
      { pickupType: 3, dropOffType: 2 },
    ]);

    expect(packed[0]).toBe(0b1110_1001);
  });

  it('calculates byte lengths and rejects invalid indexes clearly', () => {
    expect(packedPickupDropOffByteLength(0)).toBe(0);
    expect(packedPickupDropOffByteLength(1)).toBe(1);
    expect(packedPickupDropOffByteLength(2)).toBe(1);
    expect(packedPickupDropOffByteLength(3)).toBe(2);
    expect(() => getPackedPickupType(new Uint8Array(1), 2)).toThrow(
      /outside/i,
    );
  });
});
