import type { RaptorRoutePattern } from './types';

export const buildPatternAdjacency = (
  patterns: readonly RaptorRoutePattern[],
  stopCount: number,
): readonly Uint32Array[] => {
  if (!Number.isInteger(stopCount) || stopCount < 0) {
    throw new RangeError('stopCount must be a nonnegative integer');
  }

  const occurrences = Array.from(
    { length: stopCount },
    (): number[] => [],
  );

  patterns.forEach((pattern, patternId) => {
    pattern.stops.forEach((stopId, stopIndex) => {
      if (stopId >= stopCount) {
        throw new RangeError(
          `Pattern ${patternId} references unknown numeric stop ${stopId}`,
        );
      }
      occurrences[stopId]?.push(patternId, stopIndex);
    });
  });

  return occurrences.map((pairs) => new Uint32Array(pairs));
};
