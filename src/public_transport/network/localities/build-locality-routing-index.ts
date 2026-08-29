import type { LocalitySourceStopEntry } from '../../prepare';
import type {
  LocalityRoutingStopEntry,
  LocalityRoutingStopIndex,
} from './types';

const MAX_UINT32 = 0xffff_ffff;

/** Resolves prepared source stop IDs into the network's dense stop indexes. */
export function buildLocalityRoutingIndex(
  localities: readonly LocalitySourceStopEntry[],
  stopIndexBySourceId: ReadonlyMap<string, number>,
): LocalityRoutingStopIndex {
  const seenLocalityIds = new Set<string>();
  const entries = localities.map((locality): LocalityRoutingStopEntry => {
    if (
      typeof locality.localityId !== 'string' ||
      locality.localityId.length === 0 ||
      locality.localityId.trim() !== locality.localityId
    ) {
      throw new Error('Prepared locality IDs must be nonempty and canonical.');
    }
    if (seenLocalityIds.has(locality.localityId)) {
      throw new Error(`Duplicate prepared locality ID "${locality.localityId}".`);
    }
    seenLocalityIds.add(locality.localityId);

    const stopIndexes = new Set<number>();
    for (const sourceStopId of locality.sourceStopIds) {
      if (typeof sourceStopId !== 'string' || sourceStopId.length === 0) {
        throw new Error(
          `Prepared locality "${locality.localityId}" contains an empty source stop ID.`,
        );
      }
      const stopIndex = stopIndexBySourceId.get(sourceStopId);
      if (stopIndex === undefined) {
        continue;
      }
      if (
        !Number.isInteger(stopIndex) ||
        stopIndex < 0 ||
        stopIndex > MAX_UINT32
      ) {
        throw new RangeError(
          `Dense stop index for source stop "${sourceStopId}" must be a Uint32 integer.`,
        );
      }
      stopIndexes.add(stopIndex);
    }

    return {
      localityId: locality.localityId,
      stopIndexes: Uint32Array.from(
        [...stopIndexes].toSorted((left, right) => left - right),
      ),
    };
  });

  return { entries };
}
