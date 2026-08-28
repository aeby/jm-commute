import { describe, expect, it } from 'vitest';

import {
  getTravelTimeMatrixCellIndex,
  MAX_TRAVEL_MINUTES,
  UNREACHABLE_TRAVEL_MINUTES,
} from '../../travel-time-matrix-format';
import {
  createCarTravelTimeRowSlab,
  decodeTravelMinutesLittleEndian,
  durationSecondsToTravelMinutes,
  encodeTravelMinutesLittleEndian,
  finalizeCarTravelTimeRowSlab,
  getMatrixTravelMinutes,
  writeCarDurationBlockToRowSlab,
} from '../travel-time-matrix';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value): void {
      if (resolvePromise === undefined) {
        throw new Error('Deferred promise was not initialized.');
      }
      resolvePromise(value);
    },
  };
}

describe('car travel-time matrix primitives', () => {
  it('rounds seconds conservatively upward to whole minutes', () => {
    expect(durationSecondsToTravelMinutes(0)).toBe(0);
    expect(durationSecondsToTravelMinutes(60)).toBe(1);
    expect(durationSecondsToTravelMinutes(60.1)).toBe(2);
    expect(durationSecondsToTravelMinutes(MAX_TRAVEL_MINUTES * 60)).toBe(
      MAX_TRAVEL_MINUTES,
    );
  });

  it('rejects invalid and overflowing durations', () => {
    for (const duration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => durationSecondsToTravelMinutes(duration)).toThrow(
        'nonnegative finite',
      );
    }
    expect(() =>
      durationSecondsToTravelMinutes(MAX_TRAVEL_MINUTES * 60 + 0.1),
    ).toThrow('exceeding the maximum');
  });

  it('uses row-major indexing and keeps directional cells distinct', () => {
    expect(getTravelTimeMatrixCellIndex(3, 0, 2)).toBe(2);
    expect(getTravelTimeMatrixCellIndex(3, 2, 0)).toBe(6);

    const values = new Uint16Array([0, 10, 20, 0]);
    const matrix = {
      localityCount: 2,
      localityIds: ['a', 'b'],
      values,
    };
    expect(getMatrixTravelMinutes(matrix, 'a', 'b')).toBe(10);
    expect(getMatrixTravelMinutes(matrix, 'b', 'a')).toBe(20);
  });

  it('encodes and decodes every value explicitly as UInt16 little-endian', () => {
    const bytes = encodeTravelMinutesLittleEndian(
      new Uint16Array([0x1234, 0xabcd, UNREACHABLE_TRAVEL_MINUTES]),
    );
    expect([...bytes]).toEqual([0x34, 0x12, 0xcd, 0xab, 0xff, 0xff]);
    expect([...decodeTravelMinutesLittleEndian(bytes)]).toEqual([
      0x1234,
      0xabcd,
      UNREACHABLE_TRAVEL_MINUTES,
    ]);
    expect(() => decodeTravelMinutesLittleEndian(new Uint8Array(3))).toThrow(
      'not divisible',
    );
  });

  it('returns undefined for the unreachable sentinel', () => {
    const matrix = {
      localityCount: 2,
      localityIds: ['a', 'b'],
      values: new Uint16Array([
        0,
        UNREACHABLE_TRAVEL_MINUTES,
        4,
        0,
      ]),
    };
    expect(getMatrixTravelMinutes(matrix, 'a', 'b')).toBeUndefined();
    expect(() => getMatrixTravelMinutes(matrix, 'missing', 'b')).toThrow(
      'Unknown origin locality ID',
    );
  });
});

describe('car travel-time row slabs', () => {
  const firstBlock = {
    destinationStartIndex: 0,
    destinationCount: 2,
    durationsSeconds: [
      [1, 61],
      [120, 999],
    ],
  } as const;
  const secondBlock = {
    destinationStartIndex: 2,
    destinationCount: 2,
    durationsSeconds: [
      [122, undefined],
      [180, 240],
    ],
  } as const;

  it('maps null-like missing values to the unreachable sentinel and guarantees self zero', () => {
    const slab = createCarTravelTimeRowSlab(2, 4);
    writeCarDurationBlockToRowSlab(slab, firstBlock);
    writeCarDurationBlockToRowSlab(slab, secondBlock);
    expect([...finalizeCarTravelTimeRowSlab(slab, 0)]).toEqual([
      0,
      2,
      3,
      UNREACHABLE_TRAVEL_MINUTES,
      2,
      0,
      3,
      4,
    ]);
  });

  it('rejects malformed rows, overlapping blocks, and incomplete slabs', () => {
    const malformed = createCarTravelTimeRowSlab(2, 4);
    expect(() =>
      writeCarDurationBlockToRowSlab(malformed, {
        destinationStartIndex: 0,
        destinationCount: 2,
        durationsSeconds: [[0, 1]],
      }),
    ).toThrow('1 rows; expected 2');
    expect(() =>
      writeCarDurationBlockToRowSlab(malformed, {
        destinationStartIndex: 0,
        destinationCount: 2,
        durationsSeconds: [[0], [0, 1]],
      }),
    ).toThrow('1 columns; expected 2');

    const overlapping = createCarTravelTimeRowSlab(2, 4);
    writeCarDurationBlockToRowSlab(overlapping, firstBlock);
    expect(() => writeCarDurationBlockToRowSlab(overlapping, firstBlock)).toThrow(
      'assigned more than once',
    );
    expect(() => finalizeCarTravelTimeRowSlab(overlapping, 0)).toThrow(
      'was never assigned',
    );
  });

  it('places async block responses deterministically regardless of completion order', async () => {
    async function generate(reverse: boolean): Promise<Uint8Array> {
      const slab = createCarTravelTimeRowSlab(2, 4);
      const first = deferred<typeof firstBlock>();
      const second = deferred<typeof secondBlock>();
      const writes = [
        first.promise.then((block) =>
          writeCarDurationBlockToRowSlab(slab, block),
        ),
        second.promise.then((block) =>
          writeCarDurationBlockToRowSlab(slab, block),
        ),
      ];
      if (reverse) {
        second.resolve(secondBlock);
        await second.promise;
        first.resolve(firstBlock);
      } else {
        first.resolve(firstBlock);
        await first.promise;
        second.resolve(secondBlock);
      }
      await Promise.all(writes);
      return encodeTravelMinutesLittleEndian(
        finalizeCarTravelTimeRowSlab(slab, 0),
      );
    }

    expect(await generate(true)).toEqual(await generate(false));
  });
});
