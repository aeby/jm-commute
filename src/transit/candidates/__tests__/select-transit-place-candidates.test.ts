import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../../../config';
import type { Locality } from '@jm/commute';
import type { TransitPlace } from '../../places';
import type {
  TransitPlaceServiceProfile,
  TransitPlaceServiceProfileDataset,
} from '../../service-profiles';
import { selectTransitPlaceCandidates } from '../select-transit-place-candidates';

const MEAN_EARTH_RADIUS_METERS = 6_371_008.8;
const LOCALITY: Locality = {
  localityId: '0000:origin',
  postalCode: '0000',
  city: 'Origin',
  latitude: 0,
  longitude: 0,
};

function latitudeAtDistance(distanceMeters: number): number {
  return (distanceMeters / MEAN_EARTH_RADIUS_METERS) * (180 / Math.PI);
}

function createPlace(id: string, distanceMeters: number): TransitPlace {
  return {
    id,
    name: `Place ${id}`,
    latitude: latitudeAtDistance(distanceMeters),
    longitude: 0,
    stopIds: [`stop-${id}`],
  };
}

function createProfile(
  placeId: string,
  overrides: Partial<TransitPlaceServiceProfile> = {},
): TransitPlaceServiceProfile {
  return {
    placeId,
    departureCount: 0,
    routeCount: 0,
    railDepartureCount: 0,
    railRouteCount: 0,
    ...overrides,
  };
}

function createDataset(
  profiles: readonly TransitPlaceServiceProfile[],
  metadataOverrides: Partial<TransitPlaceServiceProfileDataset> = {},
): TransitPlaceServiceProfileDataset {
  const { referenceScenario } = PROJECT_CONFIG.transit;

  return {
    serviceDate: referenceScenario.serviceDate,
    windowStart: referenceScenario.morningWindow.start,
    windowEnd: referenceScenario.morningWindow.end,
    profiles,
    ...metadataOverrides,
  };
}

function datasetForPlaces(
  places: readonly TransitPlace[],
  overridesById: Readonly<
    Record<string, Partial<TransitPlaceServiceProfile>>
  > = {},
): TransitPlaceServiceProfileDataset {
  return createDataset(
    places.map(({ id }) => createProfile(id, overridesById[id])),
  );
}

describe('selectTransitPlaceCandidates membership', () => {
  it('includes a candidate exactly 700 metres away', () => {
    const place = createPlace('boundary', 700);
    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      [place],
      datasetForPlaces([place]),
    );

    expect(selection.mode).toBe('WITHIN_ACCESS_RADIUS');
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0]?.distanceMeters).toBeCloseTo(700, 8);
  });

  it('excludes a candidate beyond 700 metres from normal selection', () => {
    const inside = createPlace('inside', 699);
    const outside = createPlace('outside', 701);
    const places = [outside, inside];

    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      places,
      datasetForPlaces(places),
    );

    expect(selection.mode).toBe('WITHIN_ACCESS_RADIUS');
    expect(selection.candidates.map(({ place }) => place.id)).toEqual([
      'inside',
    ]);
  });

  it('returns every candidate within the radius', () => {
    const places = [
      createPlace('one', 100),
      createPlace('two', 300),
      createPlace('three', 699),
    ];

    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      places,
      datasetForPlaces(places),
    );

    expect(selection.mode).toBe('WITHIN_ACCESS_RADIUS');
    expect(selection.candidates.map(({ place }) => place.id)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('does not limit normal selection to ten candidates', () => {
    const places = Array.from({ length: 12 }, (_, index) =>
      createPlace(`place-${String(index).padStart(2, '0')}`, 100 + index),
    );

    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      places,
      datasetForPlaces(places),
    );

    expect(selection.mode).toBe('WITHIN_ACCESS_RADIUS');
    expect(selection.candidates).toHaveLength(12);
  });

  it('uses fallback only when no place is inside the access radius', () => {
    const inside = createPlace('inside', 699);
    const outside = createPlace('outside', 701);
    const places = [outside, inside];

    expect(
      selectTransitPlaceCandidates(
        LOCALITY,
        places,
        datasetForPlaces(places),
      ).mode,
    ).toBe('WITHIN_ACCESS_RADIUS');
  });

  it('uses the ten geographically nearest places as fallback membership', () => {
    const places = Array.from({ length: 12 }, (_, index) =>
      createPlace(`place-${String(index + 1).padStart(2, '0')}`, 1_000 + index),
    );
    const dataset = datasetForPlaces(places, {
      'place-12': { departureCount: 1_000, routeCount: 1_000 },
    });

    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      places.toReversed(),
      dataset,
    );

    expect(selection.mode).toBe('NEAREST_FALLBACK');
    expect(
      selection.candidates
        .map(({ place }) => place.id)
        .toSorted(),
    ).toEqual(places.slice(0, 10).map(({ id }) => id));
    expect(selection.candidates.some(({ place }) => place.id === 'place-12'))
      .toBe(false);
  });

  it('returns every available place when fallback has fewer than ten', () => {
    const places = [createPlace('a', 800), createPlace('b', 900)];

    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      places,
      datasetForPlaces(places),
    );

    expect(selection.mode).toBe('NEAREST_FALLBACK');
    expect(selection.candidates).toHaveLength(2);
  });

  it('respects a custom access radius', () => {
    const place = createPlace('custom-radius', 800);

    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      [place],
      datasetForPlaces([place]),
      { maxAccessDistanceMeters: 800 },
    );

    expect(selection.mode).toBe('WITHIN_ACCESS_RADIUS');
    expect(selection.candidates).toHaveLength(1);
  });

  it('respects a custom fallback candidate count', () => {
    const places = [
      createPlace('one', 800),
      createPlace('two', 900),
      createPlace('three', 1_000),
    ];

    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      places,
      datasetForPlaces(places),
      { fallbackCandidateCount: 2 },
    );

    expect(selection.mode).toBe('NEAREST_FALLBACK');
    expect(selection.candidates.map(({ place }) => place.id)).toEqual([
      'one',
      'two',
    ]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxAccessDistanceMeters %s',
    (maxAccessDistanceMeters) => {
      expect(() =>
        selectTransitPlaceCandidates(
          LOCALITY,
          [],
          createDataset([]),
          { maxAccessDistanceMeters },
        ),
      ).toThrow(/maxAccessDistanceMeters.*finite number/i);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid fallbackCandidateCount %s',
    (fallbackCandidateCount) => {
      expect(() =>
        selectTransitPlaceCandidates(
          LOCALITY,
          [],
          createDataset([]),
          { fallbackCandidateCount },
        ),
      ).toThrow(/fallbackCandidateCount.*positive integer/i);
    },
  );

  it('returns an empty fallback list for empty transit-place input', () => {
    expect(
      selectTransitPlaceCandidates(LOCALITY, [], createDataset([])),
    ).toEqual({ mode: 'NEAREST_FALLBACK', candidates: [] });
  });

  it('reports candidate distances in metres and preserves place identity', () => {
    const place = createPlace('one-kilometre', 1_000);
    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      [place],
      datasetForPlaces([place]),
    );

    expect(selection.candidates[0]?.place).toBe(place);
    expect(selection.candidates[0]?.distanceMeters).toBeCloseTo(1_000, 8);
  });

  it('keeps zero-service places eligible and ranks them below active places', () => {
    const inactive = createPlace('inactive', 100);
    const active = createPlace('active', 200);
    const places = [inactive, active];
    const dataset = datasetForPlaces(places, {
      active: { departureCount: 1, routeCount: 1 },
    });

    const selection = selectTransitPlaceCandidates(
      LOCALITY,
      places,
      dataset,
    );

    expect(selection.candidates.map(({ place }) => place.id)).toEqual([
      'active',
      'inactive',
    ]);
  });

  it('does not mutate the locality, places, profiles, dataset, or options', () => {
    const locality = structuredClone(LOCALITY);
    const places = [createPlace('far', 900), createPlace('near', 800)];
    const dataset = datasetForPlaces(places, {
      far: { departureCount: 2, routeCount: 2 },
    });
    const options = {
      maxAccessDistanceMeters: 600,
      fallbackCandidateCount: 2,
    };
    const originalLocality = structuredClone(locality);
    const originalPlaces = structuredClone(places);
    const originalDataset = structuredClone(dataset);
    const originalOptions = structuredClone(options);

    selectTransitPlaceCandidates(locality, places, dataset, options);

    expect(locality).toEqual(originalLocality);
    expect(places).toEqual(originalPlaces);
    expect(dataset).toEqual(originalDataset);
    expect(options).toEqual(originalOptions);
  });
});

describe('selectTransitPlaceCandidates profile validation', () => {
  const place = createPlace('known', 100);

  it('rejects a missing profile', () => {
    expect(() =>
      selectTransitPlaceCandidates(LOCALITY, [place], createDataset([])),
    ).toThrow(/missing service profile.*known/i);
  });

  it('rejects duplicate profile IDs', () => {
    expect(() =>
      selectTransitPlaceCandidates(
        LOCALITY,
        [place],
        createDataset([createProfile('known'), createProfile('known')]),
      ),
    ).toThrow(/duplicate service profile.*known/i);
  });

  it('rejects profiles for unknown transit places', () => {
    expect(() =>
      selectTransitPlaceCandidates(
        LOCALITY,
        [place],
        createDataset([
          createProfile('known'),
          createProfile('unknown'),
        ]),
      ),
    ).toThrow(/unknown transit-place ID.*unknown/i);
  });

  it.each([
    ['departureCount', -1],
    ['routeCount', -1],
    ['railDepartureCount', -1],
    ['railRouteCount', -1],
  ] as const)('rejects a negative %s', (field, value) => {
    expect(() =>
      selectTransitPlaceCandidates(
        LOCALITY,
        [place],
        createDataset([createProfile('known', { [field]: value })]),
      ),
    ).toThrow(new RegExp(`${field}.*nonnegative integer`, 'i'));
  });

  it.each([
    ['departureCount', 1.5],
    ['routeCount', 1.5],
    ['railDepartureCount', 1.5],
    ['railRouteCount', 1.5],
  ] as const)('rejects a noninteger %s', (field, value) => {
    expect(() =>
      selectTransitPlaceCandidates(
        LOCALITY,
        [place],
        createDataset([createProfile('known', { [field]: value })]),
      ),
    ).toThrow(new RegExp(`${field}.*nonnegative integer`, 'i'));
  });

  it('rejects a service-date mismatch', () => {
    expect(() =>
      selectTransitPlaceCandidates(
        LOCALITY,
        [place],
        createDataset([createProfile('known')], {
          serviceDate: '2026-09-08',
        }),
      ),
    ).toThrow(/serviceDate mismatch/i);
  });

  it.each([
    ['windowStart', '07:01:00'],
    ['windowEnd', '08:59:59'],
  ] as const)('rejects a %s mismatch', (field, value) => {
    expect(() =>
      selectTransitPlaceCandidates(
        LOCALITY,
        [place],
        createDataset([createProfile('known')], { [field]: value }),
      ),
    ).toThrow(new RegExp(`${field} mismatch`, 'i'));
  });
});
