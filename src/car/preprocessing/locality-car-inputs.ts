import type { Locality } from '@jm/commute';
import type { CarLocalityInput } from './types';

function compareByLocalityId(
  left: CarLocalityInput,
  right: CarLocalityInput,
): number {
  return left.localityId < right.localityId
    ? -1
    : left.localityId > right.localityId
      ? 1
      : 0;
}

/**
 * Adapts the official, transport-independent localities for offline car
 * preprocessing. Sorting by the existing canonical locality ID is equivalent
 * to the repository's postal-code/normalized-city locality ordering.
 */
export function buildCarLocalityInputs(
  localities: readonly Locality[],
): readonly CarLocalityInput[] {
  return localities
    .map(({ localityId, postalCode, city, latitude, longitude }) => ({
      localityId,
      postalCode,
      city,
      latitude,
      longitude,
    }))
    .toSorted(compareByLocalityId);
}
