import { describe, expect, it } from 'vitest';

import {
  collectReachablePatterns,
  createReachablePatternScratch,
} from '../collect-reachable-patterns';
import { testPattern, testTimetable } from './test-timetable';

const stopTime = { arrival: 0, departure: 0 };
const timetable = testTimetable(6, [
  testPattern([0, 1, 2], [[stopTime, stopTime, stopTime]]),
  testPattern([2, 3], [[stopTime, stopTime]]),
  testPattern([4], [[stopTime]]),
  testPattern([5, 1, 5], [[stopTime, stopTime, stopTime]]),
]);

describe('RAPTOR reachable pattern collection', () => {
  it('finds every pattern serving a marked stop', () => {
    const scratch = createReachablePatternScratch(timetable.patterns.length);

    expect(collectReachablePatterns(timetable, [2], scratch)).toEqual([0, 1]);
  });

  it('collects one scan for several marked stops on one pattern', () => {
    const scratch = createReachablePatternScratch(timetable.patterns.length);

    expect(collectReachablePatterns(timetable, [1, 2], scratch)).toEqual([
      0,
      1,
      3,
    ]);
    expect(scratch.patternIds.filter((patternId) => patternId === 0)).toHaveLength(
      1,
    );
  });

  it('selects the earliest marked position in a pattern', () => {
    const scratch = createReachablePatternScratch(timetable.patterns.length);

    collectReachablePatterns(timetable, [2, 1], scratch);

    expect(scratch.earliestScanIndexByPattern[0]).toBe(1);
  });

  it('selects the earliest occurrence of a repeated stop', () => {
    const scratch = createReachablePatternScratch(timetable.patterns.length);

    collectReachablePatterns(timetable, [5], scratch);

    expect(scratch.earliestScanIndexByPattern[3]).toBe(0);
  });

  it('does not collect patterns unrelated to marked stops', () => {
    const scratch = createReachablePatternScratch(timetable.patterns.length);

    collectReachablePatterns(timetable, [0], scratch);

    expect(scratch.patternIds).toEqual([0]);
    expect(scratch.earliestScanIndexByPattern[1]).toBe(-1);
    expect(scratch.earliestScanIndexByPattern[2]).toBe(-1);
  });

  it('resets and reuses dense scratch state between rounds', () => {
    const scratch = createReachablePatternScratch(timetable.patterns.length);

    collectReachablePatterns(timetable, [2], scratch);
    collectReachablePatterns(timetable, [4], scratch);

    expect(scratch.patternIds).toEqual([2]);
    expect(scratch.earliestScanIndexByPattern[0]).toBe(-1);
    expect(scratch.earliestScanIndexByPattern[1]).toBe(-1);
  });
});
