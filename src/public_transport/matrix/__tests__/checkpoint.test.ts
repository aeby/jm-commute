import { describe, expect, it } from 'vitest';

import {
  createTransitTravelTimeMatrixCheckpoint,
  expectedTransitPartialMatrixByteLength,
  parseTransitTravelTimeMatrixCheckpoint,
  parseTransitTravelTimeMatrixCheckpointJson,
  serializeTransitTravelTimeMatrixCheckpoint,
  validateTransitTravelTimeMatrixResume,
  type TransitTravelTimeMatrixResumeIdentity,
} from '../checkpoint';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const SHA_E = 'e'.repeat(64);

const identity: TransitTravelTimeMatrixResumeIdentity = {
  localityCount: 4,
  maxTravelMinutes: 240,
  valueEncoding: 'UINT8',
  routingDataFingerprint: SHA_B,
  timetableFingerprint: SHA_C,
  localityRoutingIndexSha256: SHA_D,
  queryPolicySha256: SHA_E,
};

describe('transit travel-time matrix checkpoints', () => {
  it('creates, serializes, and parses deterministic row progress', () => {
    const checkpoint = createTransitTravelTimeMatrixCheckpoint(identity, 2);
    const serialized = serializeTransitTravelTimeMatrixCheckpoint(checkpoint);

    expect(parseTransitTravelTimeMatrixCheckpointJson(serialized)).toEqual(
      checkpoint,
    );
    expect(serialized).not.toContain('timestamp');
    expect(serialized).toBe(
      serializeTransitTravelTimeMatrixCheckpoint(checkpoint),
    );
  });

  it('accepts progress from zero through the final origin', () => {
    expect(
      createTransitTravelTimeMatrixCheckpoint(identity, 0).nextOriginIndex,
    ).toBe(0);
    expect(
      createTransitTravelTimeMatrixCheckpoint(identity, 4).nextOriginIndex,
    ).toBe(4);
  });

  it('strictly rejects wrong schema, horizon, encoding, hashes, and keys', () => {
    const checkpoint = createTransitTravelTimeMatrixCheckpoint(identity, 2);
    for (const value of [
      { ...checkpoint, schemaVersion: 2 },
      { ...checkpoint, maxTravelMinutes: 120 },
      { ...checkpoint, valueEncoding: 'UINT16_LE' },
      { ...checkpoint, timetableFingerprint: 'not-a-hash' },
      { ...checkpoint, nextOriginIndex: 5 },
      { ...checkpoint, unexpected: true },
    ]) {
      expect(() => parseTransitTravelTimeMatrixCheckpoint(value)).toThrow(
        'Invalid transit travel-time matrix checkpoint',
      );
    }
  });

  it('derives and validates the exact partial binary length', () => {
    const checkpoint = createTransitTravelTimeMatrixCheckpoint(identity, 2);
    const expectedLength = expectedTransitPartialMatrixByteLength(4, 2);
    expect(expectedLength).toBe(8);
    expect(() =>
      validateTransitTravelTimeMatrixResume(
        checkpoint,
        identity,
        expectedLength,
      ),
    ).not.toThrow();
    expect(() =>
      validateTransitTravelTimeMatrixResume(checkpoint, identity, 7),
    ).toThrow('requires exactly 8');
  });

  it('rejects stale routing and locality generation identities', () => {
    const checkpoint = createTransitTravelTimeMatrixCheckpoint(identity, 2);
    const expectedLength = expectedTransitPartialMatrixByteLength(4, 2);
    for (const changedIdentity of [
      { ...identity, routingDataFingerprint: SHA_C },
      { ...identity, timetableFingerprint: SHA_D },
      { ...identity, localityRoutingIndexSha256: SHA_A },
      { ...identity, queryPolicySha256: SHA_A },
      { ...identity, localityCount: 5 },
    ]) {
      expect(() =>
        validateTransitTravelTimeMatrixResume(
          checkpoint,
          changedIdentity,
          expectedLength,
        ),
      ).toThrow('does not match current generation');
    }
  });

  it('rejects invalid partial-length inputs', () => {
    expect(() => expectedTransitPartialMatrixByteLength(0, 0)).toThrow(
      'positive safe integer',
    );
    expect(() => expectedTransitPartialMatrixByteLength(4, 5)).toThrow(
      'from 0 to 4',
    );
    expect(() =>
      validateTransitTravelTimeMatrixResume(
        createTransitTravelTimeMatrixCheckpoint(identity, 0),
        identity,
        -1,
      ),
    ).toThrow('nonnegative integer');
  });
});
