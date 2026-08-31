import { describe, expect, it } from 'vitest';

import type { Locality } from '@jobmate/commute';
import type { TransitPlace } from '../places';
import { buildLocalitySourceStopEntries } from '../build-locality-source-stop-entries';

const MEAN_EARTH_RADIUS_METERS = 6_371_008.8;
const SELECTION_OPTIONS = {
  maxAccessDistanceMeters: 700,
  fallbackCandidateCount: 10,
} as const;
const ORIGIN: Locality = {
  localityId: '8001:zurich',
  postalCode: '8001',
  city: 'Zürich',
  latitude: 0,
  longitude: 0,
};

function latitudeAtDistance(distanceMeters: number): number {
  return (distanceMeters / MEAN_EARTH_RADIUS_METERS) * (180 / Math.PI);
}

function place(
  id: string,
  distanceMeters: number,
  stopIds: readonly string[] = [`stop-${id}`],
): TransitPlace {
  return {
    id,
    latitude: latitudeAtDistance(distanceMeters),
    longitude: 0,
    stopIds,
  };
}

describe('buildLocalitySourceStopEntries', () => {
  it('uses every place within the access radius and sorts unique source IDs', () => {
    const entries = buildLocalitySourceStopEntries(
      [ORIGIN],
      [
        place('outside', 701, ['outside']),
        place('inside-b', 699, ['shared', 'b']),
        place('boundary', 700, ['a', 'shared']),
      ],
      SELECTION_OPTIONS,
    );

    expect(entries).toEqual([
      {
        localityId: '8001:zurich',
        sourceStopIds: ['a', 'b', 'shared'],
      },
    ]);
  });

  it('does not limit normal membership to the fallback count', () => {
    const places = Array.from({ length: 12 }, (_, index) =>
      place(`place-${index}`, 100 + index),
    );

    expect(
      buildLocalitySourceStopEntries(
        [ORIGIN],
        places,
        SELECTION_OPTIONS,
      )[0]?.sourceStopIds,
    ).toHaveLength(12);
  });

  it('uses only the geographically nearest places as fallback membership', () => {
    const places = Array.from({ length: 12 }, (_, index) =>
      place(`place-${String(index + 1).padStart(2, '0')}`, 1_000 + index),
    );

    expect(
      buildLocalitySourceStopEntries(
        [ORIGIN],
        places.toReversed(),
        SELECTION_OPTIONS,
      )[0]?.sourceStopIds,
    ).toEqual(
      places
        .slice(0, 10)
        .map(({ stopIds }) => stopIds[0])
        .toSorted(),
    );
  });

  it('supports explicit access and fallback policy values', () => {
    const places = [
      place('one', 800),
      place('two', 900),
      place('three', 1_000),
    ];

    expect(
      buildLocalitySourceStopEntries([ORIGIN], places, {
        maxAccessDistanceMeters: 600,
        fallbackCandidateCount: 2,
      })[0]?.sourceStopIds,
    ).toEqual(['stop-one', 'stop-two']);
    expect(
      buildLocalitySourceStopEntries([ORIGIN], [place('boundary', 800)], {
        maxAccessDistanceMeters: 800,
        fallbackCandidateCount: 10,
      })[0]?.sourceStopIds,
    ).toEqual(['stop-boundary']);
  });

  it('keeps localities with no available places', () => {
    expect(
      buildLocalitySourceStopEntries([ORIGIN], [], SELECTION_OPTIONS),
    ).toEqual([
      { localityId: '8001:zurich', sourceStopIds: [] },
    ]);
  });

  it('sorts canonical locality IDs independently of input order', () => {
    const bern: Locality = {
      localityId: '3011:bern',
      postalCode: '3011',
      city: 'Bern',
      latitude: latitudeAtDistance(2_000),
      longitude: 0,
    };
    const places = [place('origin', 0), place('remote', 2_000)];

    const forward = buildLocalitySourceStopEntries(
      [ORIGIN, bern],
      places,
      { maxAccessDistanceMeters: 700, fallbackCandidateCount: 1 },
    );
    const reversed = buildLocalitySourceStopEntries(
      [bern, ORIGIN],
      places.toReversed(),
      { maxAccessDistanceMeters: 700, fallbackCandidateCount: 1 },
    );

    expect(forward).toEqual(reversed);
    expect(forward).toEqual([
      { localityId: '3011:bern', sourceStopIds: ['stop-remote'] },
      { localityId: '8001:zurich', sourceStopIds: ['stop-origin'] },
    ]);
  });

  it('rejects duplicate locality IDs', () => {
    expect(() =>
      buildLocalitySourceStopEntries(
        [ORIGIN, { ...ORIGIN }],
        [],
        SELECTION_OPTIONS,
      ),
    ).toThrow(/duplicate public-transport locality id/i);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxAccessDistanceMeters %s',
    (maxAccessDistanceMeters) => {
      expect(() =>
        buildLocalitySourceStopEntries([ORIGIN], [], {
          maxAccessDistanceMeters,
          fallbackCandidateCount: 10,
        }),
      ).toThrow(/maxAccessDistanceMeters.*finite number/i);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid fallbackCandidateCount %s',
    (fallbackCandidateCount) => {
      expect(() =>
        buildLocalitySourceStopEntries([ORIGIN], [], {
          maxAccessDistanceMeters: 700,
          fallbackCandidateCount,
        }),
      ).toThrow(/fallbackCandidateCount.*positive integer/i);
    },
  );
});
