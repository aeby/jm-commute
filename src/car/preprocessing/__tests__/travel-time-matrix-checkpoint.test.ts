import { describe, expect, it } from 'vitest';

import {
  createCarTravelTimeMatrixCheckpoint,
  expectedPartialMatrixByteLength,
  parseCarTravelTimeMatrixCheckpoint,
  parseCarTravelTimeMatrixCheckpointJson,
  serializeCarTravelTimeMatrixCheckpoint,
  validateCarTravelTimeMatrixResume,
} from '../travel-time-matrix-checkpoint';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const identity = {
  anchorsSha256: SHA_A,
  localityCount: 123,
  blockSize: 50,
  valueEncoding: 'UINT16_LE',
} as const;

describe('car travel-time matrix checkpoints', () => {
  it('creates, serializes, and parses deterministic completed-block progress', () => {
    const checkpoint = createCarTravelTimeMatrixCheckpoint(identity, 100);
    const serialized = serializeCarTravelTimeMatrixCheckpoint(checkpoint);
    expect(parseCarTravelTimeMatrixCheckpointJson(serialized)).toEqual(
      checkpoint,
    );
    expect(serialized).not.toContain('timestamp');
  });

  it('allows the final partial block to end exactly at locality count', () => {
    expect(
      createCarTravelTimeMatrixCheckpoint(identity, 123).nextSourceIndex,
    ).toBe(123);
  });

  it('rejects wrong schema, encoding, extra keys, and non-block progress', () => {
    const checkpoint = createCarTravelTimeMatrixCheckpoint(identity, 100);
    for (const value of [
      { ...checkpoint, schemaVersion: 2 },
      { ...checkpoint, valueEncoding: 'UINT16_BE' },
      { ...checkpoint, nextSourceIndex: 99 },
      { ...checkpoint, extra: true },
    ]) {
      expect(() => parseCarTravelTimeMatrixCheckpoint(value)).toThrow(
        'Invalid car travel-time matrix checkpoint',
      );
    }
  });

  it('validates generation identity and exact partial file length', () => {
    const checkpoint = createCarTravelTimeMatrixCheckpoint(identity, 100);
    const expectedLength = expectedPartialMatrixByteLength(123, 100);
    expect(() =>
      validateCarTravelTimeMatrixResume(
        checkpoint,
        identity,
        expectedLength,
      ),
    ).not.toThrow();
    expect(() =>
      validateCarTravelTimeMatrixResume(checkpoint, identity, expectedLength - 2),
    ).toThrow('requires exactly');
  });

  it('rejects incompatible anchor SHA, count, block size, and encoding', () => {
    const checkpoint = createCarTravelTimeMatrixCheckpoint(identity, 100);
    const partialLength = expectedPartialMatrixByteLength(123, 100);
    for (const changedIdentity of [
      { ...identity, anchorsSha256: SHA_B },
      { ...identity, localityCount: 124 },
      { ...identity, blockSize: 25 },
      { ...identity, valueEncoding: 'UINT16_BE' as 'UINT16_LE' },
    ]) {
      expect(() =>
        validateCarTravelTimeMatrixResume(
          checkpoint,
          changedIdentity,
          partialLength,
        ),
      ).toThrow('does not match current generation');
    }
  });
});
