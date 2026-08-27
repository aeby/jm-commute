import type { TransitPlaceCandidate } from './types';

function compareDescending(left: number, right: number): number {
  if (left > right) {
    return -1;
  }

  if (left < right) {
    return 1;
  }

  return 0;
}

function compareAscending(left: number, right: number): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function compareTransitPlaceCandidates(
  left: TransitPlaceCandidate,
  right: TransitPlaceCandidate,
): number {
  const routeComparison = compareDescending(
    left.profile.routeCount,
    right.profile.routeCount,
  );

  if (routeComparison !== 0) {
    return routeComparison;
  }

  const departureComparison = compareDescending(
    left.profile.departureCount,
    right.profile.departureCount,
  );

  if (departureComparison !== 0) {
    return departureComparison;
  }

  const railRouteComparison = compareDescending(
    left.profile.railRouteCount,
    right.profile.railRouteCount,
  );

  if (railRouteComparison !== 0) {
    return railRouteComparison;
  }

  const railDepartureComparison = compareDescending(
    left.profile.railDepartureCount,
    right.profile.railDepartureCount,
  );

  if (railDepartureComparison !== 0) {
    return railDepartureComparison;
  }

  const distanceComparison = compareAscending(
    left.distanceMeters,
    right.distanceMeters,
  );

  if (distanceComparison !== 0) {
    return distanceComparison;
  }

  if (left.place.id < right.place.id) {
    return -1;
  }

  if (left.place.id > right.place.id) {
    return 1;
  }

  return 0;
}
