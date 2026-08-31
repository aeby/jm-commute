import { describe, expect, it } from 'vitest';

import { UNAVAILABLE_TRAVEL_TIME } from '@commute-internal/matrix';

import {
  createTravelTimeBlock,
  encodeRoadDuration,
  finalizeTravelTimeBlock,
  writeDurationTable,
} from '../travel-time-block';

describe('road travel-time blocks', () => {
  it('rounds upward and writes the final UInt8 horizon directly', () => {
    expect(encodeRoadDuration(0)).toBe(0);
    expect(encodeRoadDuration(60.1)).toBe(2);
    expect(encodeRoadDuration(240 * 60)).toBe(240);
    expect(encodeRoadDuration(240 * 60 + 0.1)).toBe(
      UNAVAILABLE_TRAVEL_TIME,
    );
    expect(encodeRoadDuration(undefined)).toBe(UNAVAILABLE_TRAVEL_TIME);

    const block = createTravelTimeBlock(2, 3);
    writeDurationTable(block, 0, 2, {
      durationsSeconds: [
        [999, 61],
        [120, 999],
      ],
    });
    writeDurationTable(block, 2, 1, {
      durationsSeconds: [[undefined], [240 * 60 + 1]],
    });
    expect([...finalizeTravelTimeBlock(block, 0)]).toEqual([
      0,
      2,
      255,
      2,
      0,
      255,
    ]);
  });

  it('rejects malformed, overlapping, and incomplete tables', () => {
    const block = createTravelTimeBlock(1, 2);
    expect(() =>
      writeDurationTable(block, 0, 2, { durationsSeconds: [[0]] }),
    ).toThrow('1 columns');
    writeDurationTable(block, 0, 1, { durationsSeconds: [[0]] });
    expect(() =>
      writeDurationTable(block, 0, 1, { durationsSeconds: [[0]] }),
    ).toThrow('assigned twice');
    expect(() => finalizeTravelTimeBlock(block, 0)).toThrow('not assigned');
  });
});
