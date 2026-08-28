import type { ReachableLocality } from '../../localities';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createCarTravelTimeIndex,
  getCarTravelMinutes,
  getCarTravelTimeIndexDiagnostics,
  getReachableLocalitiesByCar,
  type CarTravelTimeIndex,
} from '../index';
import {
  UNREACHABLE_TRAVEL_MINUTES,
  type CarTravelTimeMatrixManifest,
} from '../travel-time-matrix-format';

const LOCALITY_IDS = [
  '1000:origin',
  '9000:zeta',
  '8000:alpha',
  '9999:isolated',
] as const;
const VALUES = [
  0,
  10,
  10,
  UNREACHABLE_TRAVEL_MINUTES,
  20,
  0,
  5,
  UNREACHABLE_TRAVEL_MINUTES,
  30,
  6,
  0,
  UNREACHABLE_TRAVEL_MINUTES,
  UNREACHABLE_TRAVEL_MINUTES,
  UNREACHABLE_TRAVEL_MINUTES,
  UNREACHABLE_TRAVEL_MINUTES,
  0,
] as const;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function manifest(): CarTravelTimeMatrixManifest {
  return {
    schemaVersion: 1,
    localityCount: LOCALITY_IDS.length,
    localityIds: LOCALITY_IDS,
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT16_LE',
    unit: 'MINUTES',
    unreachableValue: UNREACHABLE_TRAVEL_MINUTES,
    rounding: 'CEIL_SECONDS_TO_MINUTES',
    anchorsSha256: SHA_A,
    localityInputSha256: SHA_B,
    roadGraph: {
      sourcePbfSha256: SHA_A,
      osrmVersion: '26.8.0',
      profile: 'car.lua',
      algorithm: 'ch',
    },
    matrixByteLength: VALUES.length * 2,
    matrixSha256: SHA_B,
  };
}

function littleEndianBytes(
  values: readonly number[] = VALUES,
): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const data = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    data.setUint16(index * 2, values[index] as number, true);
  }
  return bytes;
}

function indexFixture(): CarTravelTimeIndex {
  return createCarTravelTimeIndex(manifest(), littleEndianBytes());
}

describe('browser-safe car travel-time index', () => {
  it('looks up directional minutes, self zero, and unreachable cells', () => {
    const index = indexFixture();
    expect(getCarTravelMinutes(index, '1000:origin', '9000:zeta')).toBe(10);
    expect(getCarTravelMinutes(index, '9000:zeta', '1000:origin')).toBe(20);
    expect(getCarTravelMinutes(index, '1000:origin', '1000:origin')).toBe(0);
    expect(
      getCarTravelMinutes(index, '1000:origin', '9999:isolated'),
    ).toBeUndefined();
  });

  it('returns inclusive reachable results ordered by duration then raw locality ID', () => {
    const reachable = getReachableLocalitiesByCar(
      indexFixture(),
      '1000:origin',
      10,
    );
    expectTypeOf(reachable).toEqualTypeOf<readonly ReachableLocality[]>();
    expect(reachable).toEqual([
      { localityId: '1000:origin', travelMinutes: 0 },
      { localityId: '8000:alpha', travelMinutes: 10 },
      { localityId: '9000:zeta', travelMinutes: 10 },
    ]);
    expect(
      getReachableLocalitiesByCar(indexFixture(), '1000:origin', 9),
    ).toEqual([{ localityId: '1000:origin', travelMinutes: 0 }]);
    expect(
      getReachableLocalitiesByCar(
        indexFixture(),
        '1000:origin',
        Number.MAX_SAFE_INTEGER,
      ),
    ).toHaveLength(3);
  });

  it('includes an exact 60-minute boundary and excludes 61 minutes', () => {
    const values: number[] = [...VALUES];
    values[1] = 60;
    values[2] = 61;
    const index = createCarTravelTimeIndex(
      manifest(),
      littleEndianBytes(values),
    );
    expect(
      getReachableLocalitiesByCar(index, '1000:origin', 60),
    ).toEqual([
      { localityId: '1000:origin', travelMinutes: 0 },
      { localityId: '9000:zeta', travelMinutes: 60 },
    ]);
  });

  it('fails clearly for unknown localities and invalid maximum minutes', () => {
    const index = indexFixture();
    expect(() => getCarTravelMinutes(index, 'missing', '1000:origin')).toThrow(
      'Unknown car-routing locality: missing',
    );
    expect(() => getCarTravelMinutes(index, '1000:origin', 'missing')).toThrow(
      'Unknown car-routing locality: missing',
    );
    expect(() =>
      getReachableLocalitiesByCar(index, 'missing', 30),
    ).toThrow('Unknown car-routing locality: missing');
    for (const maximum of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        getReachableLocalitiesByCar(index, '1000:origin', maximum),
      ).toThrow('nonnegative safe integer');
    }
  });

  it('rejects wrong binary lengths and nonzero diagonal values', () => {
    const bytes = littleEndianBytes();
    expect(() =>
      createCarTravelTimeIndex(manifest(), bytes.subarray(0, bytes.length - 2)),
    ).toThrow('manifest expects 32');

    const nonzeroDiagonal = littleEndianBytes();
    new DataView(
      nonzeroDiagonal.buffer,
      nonzeroDiagonal.byteOffset,
      nonzeroDiagonal.byteLength,
    ).setUint16(0, 1, true);
    expect(() =>
      createCarTravelTimeIndex(manifest(), nonzeroDiagonal),
    ).toThrow('self cell for "1000:origin" must be 0');
  });

  it('uses the aligned zero-copy path on native little-endian hosts', () => {
    const bytes = littleEndianBytes();
    const index = createCarTravelTimeIndex(manifest(), bytes);
    const diagnostics = getCarTravelTimeIndexDiagnostics(index);
    expect(diagnostics.matrixValuesByteLength).toBe(bytes.byteLength);
    expect(diagnostics.localityIndexEntryCount).toBe(LOCALITY_IDS.length);
    expect(diagnostics.matrixBytesCopied).toBe(
      !diagnostics.nativeLittleEndian,
    );

    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(
      2,
      11,
      true,
    );
    expect(getCarTravelMinutes(index, '1000:origin', '9000:zeta')).toBe(
      diagnostics.nativeLittleEndian ? 11 : 10,
    );
  });

  it('respects unaligned Uint8Array subviews through explicit LE decoding', () => {
    const bytes = littleEndianBytes();
    const storage = new Uint8Array(bytes.byteLength + 2);
    storage.fill(0xee);
    storage.set(bytes, 1);
    const unaligned = storage.subarray(1, 1 + bytes.byteLength);
    const index = createCarTravelTimeIndex(manifest(), unaligned);
    expect(getCarTravelTimeIndexDiagnostics(index).matrixBytesCopied).toBe(true);
    expect(getCarTravelMinutes(index, '9000:zeta', '1000:origin')).toBe(20);

    new DataView(storage.buffer).setUint16(1 + 8, 21, true);
    expect(getCarTravelMinutes(index, '9000:zeta', '1000:origin')).toBe(20);
  });

  it('accepts ArrayBuffer input while keeping matrix internals opaque', () => {
    const bytes = littleEndianBytes();
    const index = createCarTravelTimeIndex(
      manifest(),
      bytes.buffer as ArrayBuffer,
    );
    expect(getCarTravelMinutes(index, '8000:alpha', '9000:zeta')).toBe(6);
    expect(Object.keys(index)).toEqual([]);
    expect(index).not.toHaveProperty('values');
    expect(index).not.toHaveProperty('localityIds');
  });
});
