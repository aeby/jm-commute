import type { RaptorTimetable } from '../../network/timetable/types';

export const UNCOLLECTED_PATTERN_INDEX = -1;

export interface ReachablePatternScratch {
  readonly earliestScanIndexByPattern: Int32Array;
  readonly patternIds: number[];
  readonly orderedPatternIds: number[];
}

export const createReachablePatternScratch = (
  patternCount: number,
): ReachablePatternScratch => {
  if (!Number.isInteger(patternCount) || patternCount < 0) {
    throw new RangeError('patternCount must be a nonnegative integer');
  }
  return {
    earliestScanIndexByPattern: new Int32Array(patternCount).fill(
      UNCOLLECTED_PATTERN_INDEX,
    ),
    patternIds: [],
    orderedPatternIds: [],
  };
};

/**
 * Collects each pattern once and records the earliest marked position from
 * which it must be scanned. The supplied dense scratch state is reused.
 */
export const collectReachablePatterns = (
  timetable: RaptorTimetable,
  markedStops: readonly number[],
  scratch: ReachablePatternScratch,
): readonly number[] => {
  if (scratch.earliestScanIndexByPattern.length !== timetable.patterns.length) {
    throw new Error('Reachable-pattern scratch size does not match timetable');
  }

  for (const patternId of scratch.patternIds) {
    scratch.earliestScanIndexByPattern[patternId] =
      UNCOLLECTED_PATTERN_INDEX;
  }
  scratch.patternIds.length = 0;
  scratch.orderedPatternIds.length = 0;

  for (const stopIndex of markedStops) {
    const occurrences = timetable.patternOccurrencesByStop[stopIndex];
    if (occurrences === undefined) {
      throw new RangeError(`Marked stop index ${stopIndex} is out of bounds`);
    }
    if (occurrences.length % 2 !== 0) {
      throw new Error(
        `Pattern occurrences for stop ${stopIndex} must contain pairs`,
      );
    }

    for (
      let occurrenceIndex = 0;
      occurrenceIndex < occurrences.length;
      occurrenceIndex += 2
    ) {
      const patternId = occurrences[occurrenceIndex];
      const patternStopIndex = occurrences[occurrenceIndex + 1];
      if (patternId === undefined || patternStopIndex === undefined) {
        throw new Error('Pattern occurrence pair is incomplete');
      }
      if (patternId >= timetable.patterns.length) {
        throw new RangeError(
          `Stop ${stopIndex} references unknown pattern ${patternId}`,
        );
      }

      const previousIndex =
        scratch.earliestScanIndexByPattern[patternId] ??
        UNCOLLECTED_PATTERN_INDEX;
      if (previousIndex === UNCOLLECTED_PATTERN_INDEX) {
        scratch.earliestScanIndexByPattern[patternId] = patternStopIndex;
        scratch.patternIds.push(patternId);
      } else if (patternStopIndex < previousIndex) {
        scratch.earliestScanIndexByPattern[patternId] = patternStopIndex;
      }
    }
  }

  for (
    let patternId = 0;
    patternId < scratch.earliestScanIndexByPattern.length;
    patternId += 1
  ) {
    if (
      scratch.earliestScanIndexByPattern[patternId] !==
      UNCOLLECTED_PATTERN_INDEX
    ) {
      scratch.orderedPatternIds.push(patternId);
    }
  }

  return scratch.orderedPatternIds;
};
