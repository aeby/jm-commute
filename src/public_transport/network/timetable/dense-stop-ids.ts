import type { StopIndex } from './types';

/** Deterministic dense indexes for opaque source stop IDs. */
export interface DenseStopIds {
  readonly sourceStopIds: readonly string[];
  readonly stopIndexBySourceId: Map<string, StopIndex>;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const buildSourceStopIndex = (
  sourceStopIds: readonly string[],
): Map<string, StopIndex> => {
  const stopIndexBySourceId = new Map<string, StopIndex>();
  sourceStopIds.forEach((sourceStopId, stopIndex) => {
    if (typeof sourceStopId !== 'string' || sourceStopId.length === 0) {
      throw new Error('Every source stop ID must be a nonempty string');
    }
    if (stopIndexBySourceId.has(sourceStopId)) {
      throw new Error(`Duplicate source stop ID ${sourceStopId}`);
    }
    stopIndexBySourceId.set(sourceStopId, stopIndex);
  });
  return stopIndexBySourceId;
};

export const buildDenseStopIds = (
  stopIds: Iterable<string>,
): DenseStopIds => {
  const uniqueStopIds = new Set<string>();

  for (const stopId of stopIds) {
    if (typeof stopId !== 'string' || stopId.length === 0) {
      throw new Error('Every source stop ID must be a nonempty string');
    }
    uniqueStopIds.add(stopId);
  }

  const sourceStopIds = [...uniqueStopIds].toSorted(compareStrings);
  const stopIndexBySourceId = buildSourceStopIndex(sourceStopIds);

  return { sourceStopIds, stopIndexBySourceId };
};
