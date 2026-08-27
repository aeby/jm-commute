import { describe, expect, it } from 'vitest';

import type { TransitPlaceServiceProfile } from '../../service-profiles';
import { compareTransitPlaceCandidates } from '../compare-transit-place-candidates';
import type { TransitPlaceCandidate } from '../types';

function createCandidate(
  id: string,
  profileOverrides: Partial<TransitPlaceServiceProfile> = {},
  distanceMeters = 100,
): TransitPlaceCandidate {
  return {
    place: {
      id,
      name: `Place ${id}`,
      latitude: 47,
      longitude: 8,
      stopIds: [`stop-${id}`],
    },
    profile: {
      placeId: id,
      departureCount: 0,
      routeCount: 0,
      railDepartureCount: 0,
      railRouteCount: 0,
      ...profileOverrides,
    },
    distanceMeters,
  };
}

function rankedIds(
  candidates: readonly TransitPlaceCandidate[],
): readonly string[] {
  return candidates
    .toSorted(compareTransitPlaceCandidates)
    .map(({ place }) => place.id);
}

describe('compareTransitPlaceCandidates', () => {
  it('ranks more all-mode routes first', () => {
    const fewerRoutes = createCandidate('fewer', {
      departureCount: 100,
      routeCount: 2,
      railDepartureCount: 100,
      railRouteCount: 2,
    });
    const moreRoutes = createCandidate('more', {
      departureCount: 3,
      routeCount: 3,
    });

    expect(rankedIds([fewerRoutes, moreRoutes])).toEqual(['more', 'fewer']);
  });

  it('ranks more departures first when route counts are equal', () => {
    const quieter = createCandidate('quieter', {
      departureCount: 4,
      routeCount: 2,
      railRouteCount: 2,
    });
    const busier = createCandidate('busier', {
      departureCount: 5,
      routeCount: 2,
    });

    expect(rankedIds([quieter, busier])).toEqual(['busier', 'quieter']);
  });

  it('ranks more rail routes first when all-mode metrics are equal', () => {
    const lessRail = createCandidate('less-rail', {
      departureCount: 10,
      routeCount: 4,
      railDepartureCount: 8,
      railRouteCount: 1,
    });
    const moreRail = createCandidate('more-rail', {
      departureCount: 10,
      routeCount: 4,
      railDepartureCount: 2,
      railRouteCount: 2,
    });

    expect(rankedIds([lessRail, moreRail])).toEqual(['more-rail', 'less-rail']);
  });

  it('ranks more rail departures first when rail-route counts are equal', () => {
    const quieterRail = createCandidate('quieter-rail', {
      departureCount: 10,
      routeCount: 4,
      railDepartureCount: 2,
      railRouteCount: 1,
    });
    const busierRail = createCandidate('busier-rail', {
      departureCount: 10,
      routeCount: 4,
      railDepartureCount: 3,
      railRouteCount: 1,
    });

    expect(rankedIds([quieterRail, busierRail])).toEqual([
      'busier-rail',
      'quieter-rail',
    ]);
  });

  it('ranks the closer place first when profile metrics are equal', () => {
    const farther = createCandidate('farther', {}, 200);
    const closer = createCandidate('closer', {}, 100);

    expect(rankedIds([farther, closer])).toEqual(['closer', 'farther']);
  });

  it('uses direct lexical place ID order as the final tie-breaker', () => {
    const placeB = createCandidate('b');
    const placeA = createCandidate('a');

    expect(rankedIds([placeB, placeA])).toEqual(['a', 'b']);
  });

  it('allows a high-frequency non-rail hub to outrank a smaller railway stop', () => {
    const railwayStop = createCandidate('railway', {
      departureCount: 8,
      routeCount: 2,
      railDepartureCount: 8,
      railRouteCount: 2,
    });
    const busOrTramHub = createCandidate('non-rail-hub', {
      departureCount: 30,
      routeCount: 5,
    });

    expect(rankedIds([railwayStop, busOrTramHub])).toEqual([
      'non-rail-hub',
      'railway',
    ]);
  });

  it('does not automatically rank a railway candidate first', () => {
    const railwayStop = createCandidate('railway', {
      departureCount: 20,
      routeCount: 1,
      railDepartureCount: 20,
      railRouteCount: 1,
    });
    const ordinaryHub = createCandidate('ordinary-hub', {
      departureCount: 3,
      routeCount: 2,
    });

    expect(rankedIds([railwayStop, ordinaryHub])).toEqual([
      'ordinary-hub',
      'railway',
    ]);
  });

  it('keeps a zero-service candidate and ranks it below an active candidate', () => {
    const inactive = createCandidate('inactive');
    const active = createCandidate('active', {
      departureCount: 1,
      routeCount: 1,
    });

    expect(rankedIds([inactive, active])).toEqual(['active', 'inactive']);
  });

  it('produces the same deterministic order for different input orders', () => {
    const candidates = [
      createCandidate('c', { departureCount: 1, routeCount: 1 }, 200),
      createCandidate('a', { departureCount: 2, routeCount: 1 }, 300),
      createCandidate('b', { departureCount: 1, routeCount: 1 }, 100),
    ];

    expect(rankedIds(candidates)).toEqual(['a', 'b', 'c']);
    expect(rankedIds(candidates.toReversed())).toEqual(['a', 'b', 'c']);
  });
});
