import { describe, expect, it } from 'vitest';

import {
  calculateTravelTimeMatrixByteLength,
  calculateTravelTimeMatrixCellCount,
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  getTravelTimeMatrixCellIndex,
  parseTravelTimeMatrixDescriptor,
  parseTravelTimeMatrixDescriptorJson,
  TRAVEL_TIME_MATRIX_BYTES_PER_CELL,
  UNAVAILABLE_TRAVEL_TIME,
  type TravelTimeMatrixDescriptor,
} from '../index';

const SHA256 = 'a'.repeat(64);

function validDescriptor(): TravelTimeMatrixDescriptor {
  return {
    schemaVersion: 1,
    localityCount: 2,
    localityIds: ['3011:bern', '8001:zurich'],
    maxTravelMinutes: COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
    layout: 'ROW_MAJOR',
    valueEncoding: 'UINT8',
    unit: 'MINUTES',
    unavailableValue: UNAVAILABLE_TRAVEL_TIME,
    matrixByteLength: 4,
    matrixSha256: SHA256,
  };
}

describe('canonical travel-time matrix descriptor', () => {
  it('strictly parses the complete transport-independent contract', () => {
    const descriptor = validDescriptor();
    expect(parseTravelTimeMatrixDescriptor(descriptor)).toEqual(descriptor);
    expect(
      parseTravelTimeMatrixDescriptorJson(JSON.stringify(descriptor)),
    ).toEqual(descriptor);
  });

  it.each([
    ['schemaVersion', 2],
    ['maxTravelMinutes', 120],
    ['maxTravelMinutes', 241],
    ['layout', 'COLUMN_MAJOR'],
    ['valueEncoding', 'UINT16_LE'],
    ['unit', 'SECONDS'],
    ['unavailableValue', 254],
  ] as const)('rejects the wrong %s', (field, value) => {
    expect(() =>
      parseTravelTimeMatrixDescriptor({
        ...validDescriptor(),
        [field]: value,
      }),
    ).toThrow(field);
  });

  it('rejects duplicate IDs, bad byte size, bad SHA, and extra fields', () => {
    expect(() =>
      parseTravelTimeMatrixDescriptor({
        ...validDescriptor(),
        localityIds: ['3011:bern', '3011:bern'],
      }),
    ).toThrow('duplicate ID "3011:bern"');
    expect(() =>
      parseTravelTimeMatrixDescriptor({
        ...validDescriptor(),
        matrixByteLength: 8,
      }),
    ).toThrow('expected 4 for 2 localities');
    expect(() =>
      parseTravelTimeMatrixDescriptor({
        ...validDescriptor(),
        matrixSha256: 'not-a-digest',
      }),
    ).toThrow('lowercase SHA-256');
    expect(() =>
      parseTravelTimeMatrixDescriptor({
        ...validDescriptor(),
        transport: 'CAR',
      }),
    ).toThrow('unexpected field(s) transport');
  });

  it('owns the one-byte row-major calculations', () => {
    expect(TRAVEL_TIME_MATRIX_BYTES_PER_CELL).toBe(1);
    expect(calculateTravelTimeMatrixCellCount(4)).toBe(16);
    expect(calculateTravelTimeMatrixByteLength(4)).toBe(16);
    expect(getTravelTimeMatrixCellIndex(4, 1, 3)).toBe(7);
    expect(getTravelTimeMatrixCellIndex(4, 3, 1)).toBe(13);
  });
});
