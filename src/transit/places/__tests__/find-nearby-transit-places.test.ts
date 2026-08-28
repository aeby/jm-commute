import { describe, expect, it } from 'vitest';

import type { Locality } from '@jm/commute';
import { findNearbyTransitPlaces } from '../find-nearby-transit-places';
import { haversineDistanceMeters } from '../haversine-distance-meters';
import type { TransitPlace } from '../types';

const LOCALITY: Locality = {
  localityId: '0000:origin',
  postalCode: '0000',
  city: 'Origin',
  latitude: 0,
  longitude: 0,
};

function createPlace(
  id: string,
  latitude: number,
  longitude = 0,
): TransitPlace {
  return {
    id,
    name: `Place ${id}`,
    latitude,
    longitude,
    stopIds: [`stop-${id}`],
  };
}

describe('findNearbyTransitPlaces', () => {
  it('returns places ordered from nearest to farthest', () => {
    const nearest = createPlace('nearest', 0.01);
    const middle = createPlace('middle', 0.02);
    const farthest = createPlace('farthest', 0.03);

    const results = findNearbyTransitPlaces(
      LOCALITY,
      [farthest, nearest, middle],
      { maxResults: 3 },
    );

    expect(results.map(({ place }) => place.id)).toEqual([
      'nearest',
      'middle',
      'farthest',
    ]);
    expect(results[0]?.distanceMeters).toBeLessThan(
      results[1]?.distanceMeters ?? 0,
    );
    expect(results[1]?.distanceMeters).toBeLessThan(
      results[2]?.distanceMeters ?? 0,
    );
  });

  it('limits the number of results', () => {
    const places = [
      createPlace('c', 0.03),
      createPlace('a', 0.01),
      createPlace('b', 0.02),
    ];

    expect(
      findNearbyTransitPlaces(LOCALITY, places, { maxResults: 2 }).map(
        ({ place }) => place.id,
      ),
    ).toEqual(['a', 'b']);
  });

  it('removes places beyond the maximum distance', () => {
    const nearby = createPlace('nearby', 0.01);
    const distant = createPlace('distant', 0.1);

    expect(
      findNearbyTransitPlaces(LOCALITY, [distant, nearby], {
        maxResults: 2,
        maxDistanceMeters: 2_000,
      }).map(({ place }) => place.id),
    ).toEqual(['nearby']);
  });

  it('includes a place exactly on the distance boundary', () => {
    const place = createPlace('boundary', 0.01);
    const distanceMeters = haversineDistanceMeters(LOCALITY, place);

    expect(
      findNearbyTransitPlaces(LOCALITY, [place], {
        maxResults: 1,
        maxDistanceMeters: distanceMeters,
      }),
    ).toEqual([{ place, distanceMeters }]);
  });

  it('returns an empty array when no place is within the radius', () => {
    const place = createPlace('outside', 0.01);

    expect(
      findNearbyTransitPlaces(LOCALITY, [place], {
        maxResults: 1,
        maxDistanceMeters: 1,
      }),
    ).toEqual([]);
  });

  it('returns an empty array for an empty place list', () => {
    expect(
      findNearbyTransitPlaces(LOCALITY, [], { maxResults: 10 }),
    ).toEqual([]);
  });

  it('sorts equal-distance places lexically by ID', () => {
    const placeB = createPlace('b', 0, -0.01);
    const placeA = createPlace('a', 0, 0.01);

    expect(
      findNearbyTransitPlaces(LOCALITY, [placeB, placeA], {
        maxResults: 2,
      }).map(({ place }) => place.id),
    ).toEqual(['a', 'b']);
  });

  it('nests the original place and reports distance in meters', () => {
    const place = createPlace('one-degree-north', 1);
    const [result] = findNearbyTransitPlaces(LOCALITY, [place], {
      maxResults: 1,
    });

    expect(result?.place).toBe(place);
    expect(result?.distanceMeters).toBeGreaterThan(111_100);
    expect(result?.distanceMeters).toBeLessThan(111_300);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxResults %s',
    (maxResults) => {
      expect(() =>
        findNearbyTransitPlaces(LOCALITY, [], { maxResults }),
      ).toThrow(/maxResults.*positive integer/i);
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxDistanceMeters %s',
    (maxDistanceMeters) => {
      expect(() =>
        findNearbyTransitPlaces(LOCALITY, [], {
          maxResults: 1,
          maxDistanceMeters,
        }),
      ).toThrow(/maxDistanceMeters.*finite number/i);
    },
  );

  it('does not mutate the locality, places, place objects, or options', () => {
    const locality = structuredClone(LOCALITY);
    const places = [createPlace('far', 0.02), createPlace('near', 0.01)];
    const options = { maxResults: 2, maxDistanceMeters: 5_000 };
    const originalLocality = structuredClone(locality);
    const originalPlaces = structuredClone(places);
    const originalOptions = structuredClone(options);

    findNearbyTransitPlaces(locality, places, options);

    expect(locality).toEqual(originalLocality);
    expect(places).toEqual(originalPlaces);
    expect(options).toEqual(originalOptions);
  });
});
