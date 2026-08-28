import type { ReachableLocality } from '../../localities';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  createTravelTimeIndex,
  getReachableLocalities,
  getTravelMinutes,
  UNAVAILABLE_TRAVEL_TIME,
  type TravelTimeIndex,
  type TravelTimeMatrixDescriptor,
} from '../index';
import { getTravelTimeIndexDiagnostics } from '../travel-time-index';

const LOCALITY_IDS = [
  '1000:origin',
  '9000:zeta',
  '8000:alpha',
  '7000:near',
  '9999:isolated',
] as const;
const VALUES = new Uint8Array([
  0,
  120,
  120,
  121,
  UNAVAILABLE_TRAVEL_TIME,
  239,
  0,
  UNAVAILABLE_TRAVEL_TIME,
  UNAVAILABLE_TRAVEL_TIME,
  UNAVAILABLE_TRAVEL_TIME,
  240,
  UNAVAILABLE_TRAVEL_TIME,
  0,
  UNAVAILABLE_TRAVEL_TIME,
  UNAVAILABLE_TRAVEL_TIME,
  1,
  UNAVAILABLE_TRAVEL_TIME,
  UNAVAILABLE_TRAVEL_TIME,
  0,
  UNAVAILABLE_TRAVEL_TIME,
  UNAVAILABLE_TRAVEL_TIME,
  UNAVAILABLE_TRAVEL_TIME,
  UNAVAILABLE_TRAVEL_TIME,
  UNAVAILABLE_TRAVEL_TIME,
  0,
]);

function descriptor(): TravelTimeMatrixDescriptor {
  return {
    schemaVersion: 1,
    localityCount: LOCALITY_IDS.length,
    localityIds: LOCALITY_IDS,
    maxTravelMinutes: COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT8',
    unit: 'MINUTES',
    unavailableValue: UNAVAILABLE_TRAVEL_TIME,
    matrixByteLength: VALUES.byteLength,
    matrixSha256: 'a'.repeat(64),
  };
}

function indexFixture(): TravelTimeIndex {
  return createTravelTimeIndex(descriptor(), VALUES.slice());
}

describe('transport-independent UInt8 travel-time index', () => {
  it('looks up row-major directional minutes, self zero, and unavailable cells', () => {
    const index = indexFixture();
    expect(getTravelMinutes(index, '1000:origin', '9000:zeta')).toBe(120);
    expect(getTravelMinutes(index, '9000:zeta', '1000:origin')).toBe(239);
    expect(getTravelMinutes(index, '1000:origin', '1000:origin')).toBe(0);
    expect(
      getTravelMinutes(index, '1000:origin', '9999:isolated'),
    ).toBeUndefined();
  });

  it('accepts encoded 120, 121, 239, and 240-minute values', () => {
    const index = indexFixture();
    expect(getTravelMinutes(index, '1000:origin', '9000:zeta')).toBe(120);
    expect(getTravelMinutes(index, '1000:origin', '7000:near')).toBe(121);
    expect(getTravelMinutes(index, '9000:zeta', '1000:origin')).toBe(239);
    expect(getTravelMinutes(index, '8000:alpha', '1000:origin')).toBe(240);
  });

  it.each([241, 254])(
    'rejects reserved encoded value %i',
    (reservedValue) => {
      const values = VALUES.slice();
      values[1] = reservedValue;
      expect(() => createTravelTimeIndex(descriptor(), values)).toThrow(
        `reserved schema-v1 value ${reservedValue}`,
      );
    },
  );

  it('returns inclusive results ordered by duration then locality ID', () => {
    const reachable = getReachableLocalities(
      indexFixture(),
      '1000:origin',
      120,
    );
    expectTypeOf(reachable).toEqualTypeOf<readonly ReachableLocality[]>();
    expect(reachable).toEqual([
      { localityId: '1000:origin', travelMinutes: 0 },
      { localityId: '8000:alpha', travelMinutes: 120 },
      { localityId: '9000:zeta', travelMinutes: 120 },
    ]);
    expect(
      getReachableLocalities(indexFixture(), '1000:origin', 121),
    ).toEqual([
      { localityId: '1000:origin', travelMinutes: 0 },
      { localityId: '8000:alpha', travelMinutes: 120 },
      { localityId: '9000:zeta', travelMinutes: 120 },
      { localityId: '7000:near', travelMinutes: 121 },
    ]);
  });

  it('accepts a 240-minute threshold and rejects values outside 0–240', () => {
    expect(() =>
      getReachableLocalities(
        indexFixture(),
        '1000:origin',
        COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
      ),
    ).not.toThrow();
    for (const maximum of [
      -1,
      30.5,
      241,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() =>
        getReachableLocalities(indexFixture(), '1000:origin', maximum),
      ).toThrow('safe integer between 0 and 240');
    }
  });

  it('fails clearly for unknown origins and destinations', () => {
    const index = indexFixture();
    expect(() => getTravelMinutes(index, 'missing', '1000:origin')).toThrow(
      'Unknown travel-time locality: missing',
    );
    expect(() => getTravelMinutes(index, '1000:origin', 'missing')).toThrow(
      'Unknown travel-time locality: missing',
    );
    expect(() => getReachableLocalities(index, 'missing', 30)).toThrow(
      'Unknown travel-time locality: missing',
    );
  });

  it('rejects the wrong byte length and every nonzero diagonal value', () => {
    expect(() =>
      createTravelTimeIndex(
        descriptor(),
        VALUES.subarray(0, VALUES.byteLength - 1),
      ),
    ).toThrow('descriptor expects 25');

    const nonzeroDiagonal = VALUES.slice();
    nonzeroDiagonal[6] = 1;
    expect(() =>
      createTravelTimeIndex(descriptor(), nonzeroDiagonal),
    ).toThrow('self cell for "9000:zeta" must be 0');
  });

  it('keeps Uint8Array and ArrayBuffer inputs as zero-copy matrix views', () => {
    const bytes = VALUES.slice();
    const fromView = createTravelTimeIndex(descriptor(), bytes);
    const viewDiagnostics = getTravelTimeIndexDiagnostics(fromView);
    expect(viewDiagnostics).toEqual({
      matrixBytesCopied: false,
      matrixValuesByteLength: VALUES.byteLength,
      localityIndexEntryCount: LOCALITY_IDS.length,
    });
    bytes[1] = 119;
    expect(getTravelMinutes(fromView, '1000:origin', '9000:zeta')).toBe(119);

    const arrayBufferBytes = VALUES.slice();
    const fromArrayBuffer = createTravelTimeIndex(
      descriptor(),
      arrayBufferBytes.buffer,
    );
    arrayBufferBytes[1] = 118;
    expect(
      getTravelMinutes(fromArrayBuffer, '1000:origin', '9000:zeta'),
    ).toBe(118);
  });

  it('keeps the runtime structure opaque', () => {
    const index = indexFixture();
    expect(Object.keys(index)).toEqual([]);
    expect(index).not.toHaveProperty('values');
    expect(index).not.toHaveProperty('localityIds');
  });
});
