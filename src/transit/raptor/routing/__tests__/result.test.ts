import { describe, expect, it } from 'vitest';

import { arrivalAt, travelTimeTo } from '../result';
import { UNREACHED_TIME } from '../state';
import type { RaptorResult } from '../types';

const result: RaptorResult = {
  departureTimeSeconds: 28_800,
  arrivalTimes: new Uint32Array([28_800, 29_820, UNREACHED_TIME]),
};

describe('RAPTOR result helpers', () => {
  it('returns reachable arrival times without exposing the sentinel', () => {
    expect(arrivalAt(result, 0)).toBe(28_800);
    expect(arrivalAt(result, 1)).toBe(29_820);
    expect(arrivalAt(result, 2)).toBeUndefined();
  });

  it('calculates travel times in seconds', () => {
    expect(travelTimeTo(result, 0)).toBe(0);
    expect(travelTimeTo(result, 1)).toBe(1_020);
    expect(travelTimeTo(result, 2)).toBeUndefined();
  });

  it('fails clearly for invalid stop indexes', () => {
    expect(() => arrivalAt(result, -1)).toThrow(/stop index/i);
    expect(() => travelTimeTo(result, 3)).toThrow(/stop index/i);
  });
});
