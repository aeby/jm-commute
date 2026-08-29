import type { Locality } from '@jm/commute';
import { haversineDistanceMeters } from './haversine-distance-meters';
import type {
  NearbyTransitPlace,
  NearbyTransitPlacesOptions,
  TransitPlace,
} from './types';

function validateOptions(options: NearbyTransitPlacesOptions): void {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('Options must be an object.');
  }

  if (!Number.isInteger(options.maxResults) || options.maxResults <= 0) {
    throw new RangeError('maxResults must be a positive integer.');
  }

  if (
    options.maxDistanceMeters !== undefined &&
    (!Number.isFinite(options.maxDistanceMeters) ||
      options.maxDistanceMeters < 0)
  ) {
    throw new RangeError(
      'maxDistanceMeters must be a finite number greater than or equal to zero.',
    );
  }
}

function compareNearbyPlaces(
  left: NearbyTransitPlace,
  right: NearbyTransitPlace,
): number {
  const distanceDifference = left.distanceMeters - right.distanceMeters;

  if (distanceDifference !== 0) {
    return distanceDifference;
  }

  if (left.place.id < right.place.id) {
    return -1;
  }

  if (left.place.id > right.place.id) {
    return 1;
  }

  return 0;
}

export function findNearbyTransitPlaces(
  locality: Locality,
  places: readonly TransitPlace[],
  options: NearbyTransitPlacesOptions,
): readonly NearbyTransitPlace[] {
  validateOptions(options);

  const nearbyPlaces: NearbyTransitPlace[] = [];

  for (const place of places) {
    const distanceMeters = haversineDistanceMeters(locality, place);

    if (
      options.maxDistanceMeters !== undefined &&
      distanceMeters > options.maxDistanceMeters
    ) {
      continue;
    }

    nearbyPlaces.push({ place, distanceMeters });
  }

  return nearbyPlaces
    .toSorted(compareNearbyPlaces)
    .slice(0, options.maxResults);
}
