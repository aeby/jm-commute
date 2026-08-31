import { describe, expect, it } from 'vitest';

import {
  createRoadMatrixCheckpoint,
  expectedRoadPartialMatrixByteLength,
  parseRoadMatrixCheckpointJson,
  serializeRoadMatrixCheckpoint,
  validateRoadMatrixResume,
  type RoadMatrixResumeIdentity,
} from '../checkpoint';

const identity: RoadMatrixResumeIdentity = {
  localityCount: 5,
  blockSize: 2,
  maxTravelMinutes: 240,
  valueEncoding: 'UINT8',
  anchorsSha256: 'a'.repeat(64),
};

describe('road matrix checkpoint', () => {
  it('round-trips completed origin blocks and validates partial size', () => {
    const checkpoint = createRoadMatrixCheckpoint(identity, 4);
    expect(
      parseRoadMatrixCheckpointJson(serializeRoadMatrixCheckpoint(checkpoint)),
    ).toEqual(checkpoint);
    expect(expectedRoadPartialMatrixByteLength(5, 4)).toBe(20);
    expect(() => validateRoadMatrixResume(checkpoint, identity, 20)).not.toThrow();
  });

  it('rejects incompatible identity, row boundaries, and byte length', () => {
    expect(() => createRoadMatrixCheckpoint(identity, 3)).toThrow(
      'completed block boundary',
    );
    expect(() =>
      validateRoadMatrixResume(
        createRoadMatrixCheckpoint(identity, 2),
        { ...identity, anchorsSha256: 'b'.repeat(64) },
        10,
      ),
    ).toThrow('does not match');
    expect(() =>
      validateRoadMatrixResume(
        createRoadMatrixCheckpoint(identity, 2),
        identity,
        9,
      ),
    ).toThrow('expected 10');
  });
});
