import type { LocalityId, ReachableLocality } from '@jm/commute';

export function createReachableLocalityMap(
  reachable: readonly ReachableLocality[],
): ReadonlyMap<LocalityId, number> {
  const travelMinutesByLocalityId = new Map<LocalityId, number>();

  for (const locality of reachable) {
    if (travelMinutesByLocalityId.has(locality.localityId)) {
      throw new Error(`Duplicate reachable locality "${locality.localityId}".`);
    }
    travelMinutesByLocalityId.set(
      locality.localityId,
      locality.travelMinutes,
    );
  }

  return travelMinutesByLocalityId;
}
