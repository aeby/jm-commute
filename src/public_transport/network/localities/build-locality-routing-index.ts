import type { Locality } from '@jobmate/commute';
import { haversineDistanceMeters } from '../../prepare/places';
import type { ActiveTransitPlace } from './collect-active-transit-places';
import type { LocalityRoutingStopIndex } from './types';

export interface LocalitySelectionOptions {
  readonly preferredRadiusMeters: number;
  /** Additional percentage credited to each usable rail departure. */
  readonly railDepartureBoostPercent: number;
}

/** Selects one physical station per locality and resolves its routing stops. */
export function buildLocalityRoutingIndex(
  localities: readonly Locality[],
  places: readonly ActiveTransitPlace[],
  stopIndexBySourceId: ReadonlyMap<string, number>,
  options: LocalitySelectionOptions,
): LocalityRoutingStopIndex {
  for (const key of ['preferredRadiusMeters', 'railDepartureBoostPercent'] as const) {
    if (!Number.isFinite(options[key]) || options[key] < 0) {
      throw new RangeError(`${key} must be a finite nonnegative number.`);
    }
  }
  const candidates = places.map((place) => ({
    place,
    score:
      place.departureCount +
      place.railDepartureCount * (options.railDepartureBoostPercent / 100),
  }));
  const sortedLocalities = localities.toSorted((left, right) =>
    left.localityId < right.localityId
      ? -1
      : left.localityId > right.localityId ? 1 : 0,
  );
  const seenLocalityIds = new Set<string>();

  const entries = sortedLocalities.map((locality) => {
    if (!locality.localityId || locality.localityId.trim() !== locality.localityId) {
      throw new Error('Locality IDs must be nonempty and canonical.');
    }
    if (seenLocalityIds.has(locality.localityId)) {
      throw new Error(`Duplicate locality ID "${locality.localityId}".`);
    }
    seenLocalityIds.add(locality.localityId);

    let nearest: ActiveTransitPlace | undefined;
    let nearestDistance = Infinity;
    let best: ActiveTransitPlace | undefined;
    let bestDistance = Infinity;
    let bestScore = -Infinity;

    for (const { place, score } of candidates) {
      const distance = haversineDistanceMeters(locality, place);
      if (
        nearest === undefined ||
        distance < nearestDistance ||
        (distance === nearestDistance && place.id < nearest.id)
      ) {
        nearest = place;
        nearestDistance = distance;
      }
      if (
        distance <= options.preferredRadiusMeters &&
        (best === undefined ||
          score > bestScore ||
          (score === bestScore &&
            (distance < bestDistance ||
              (distance === bestDistance && place.id < best.id))))
      ) {
        best = place;
        bestScore = score;
        bestDistance = distance;
      }
    }

    const selectedPlace = best ?? nearest;
    const stopIndexes = new Set<number>();
    for (const stopId of selectedPlace?.stopIds ?? []) {
      const index = stopIndexBySourceId.get(stopId);
      if (index === undefined) {
        continue;
      }
      if (!Number.isInteger(index) || index < 0 || index > 0xffff_ffff) {
        throw new RangeError(`Dense stop index for "${stopId}" must be a Uint32 integer.`);
      }
      stopIndexes.add(index);
    }
    return {
      localityId: locality.localityId,
      stopIndexes: Uint32Array.from([...stopIndexes].toSorted((a, b) => a - b)),
      ...(selectedPlace === undefined
        ? {}
        : { stationName: selectedPlace.name }),
    };
  });
  return { entries };
}
