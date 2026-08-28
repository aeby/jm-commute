import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../../../config';
import type { Locality } from '@jm/commute';
import type { TransitPlace } from '../../places';
import type {
  TransitPlaceServiceProfile,
  TransitPlaceServiceProfileDataset,
} from '../../service-profiles';
import { buildLocalityRoutingIndex } from '../build-locality-routing-index';
import { parseLocalityRoutingIndexJson } from '..';

const ORIGIN: Locality = {
  localityId: '8001:zurich',
  postalCode: '8001',
  city: 'Zürich',
  latitude: 47,
  longitude: 8,
};

function place(
  id: string,
  latitude: number,
  stopIds: readonly string[],
): TransitPlace {
  return { id, name: id, latitude, longitude: 8, stopIds };
}

function profile(placeId: string): TransitPlaceServiceProfile {
  return {
    placeId,
    departureCount: 1,
    routeCount: 1,
    railDepartureCount: 0,
    railRouteCount: 0,
  };
}

function dataset(
  places: readonly TransitPlace[],
): TransitPlaceServiceProfileDataset {
  const scenario = PROJECT_CONFIG.transit.referenceScenario;
  return {
    serviceDate: scenario.serviceDate,
    windowStart: scenario.morningWindow.start,
    windowEnd: scenario.morningWindow.end,
    profiles: places.map(({ id }) => profile(id)),
  };
}

describe('buildLocalityRoutingIndex', () => {
  it('uses every selected place, maps active IDs, deduplicates, and sorts', () => {
    const places = [
      place('one', 47, ['active-b', 'inactive', 'shared']),
      place('two', 47.001, ['shared', 'active-a']),
      place('outside', 48, ['outside']),
    ];
    const index = buildLocalityRoutingIndex(
      [ORIGIN],
      places,
      dataset(places),
      new Map([
        ['active-a', 7],
        ['active-b', 2],
        ['shared', 7],
        ['outside', 9],
      ]),
    );

    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toMatchObject({
      localityId: '8001:zurich',
      selectionMode: 'WITHIN_ACCESS_RADIUS',
    });
    expect(index.entries[0]?.stopIndexes).toEqual(new Uint32Array([2, 7]));
  });

  it('preserves fallback mode and keeps localities with no active stops', () => {
    const places = [place('remote', 48, ['inactive'])];
    const [entry] = buildLocalityRoutingIndex(
      [ORIGIN],
      places,
      dataset(places),
      new Map(),
    ).entries;

    expect(entry?.selectionMode).toBe('NEAREST_FALLBACK');
    expect(entry?.stopIndexes).toEqual(new Uint32Array());
  });

  it('is independent of input ordering', () => {
    const bern: Locality = {
      localityId: '3011:bern',
      postalCode: '3011',
      city: 'Bern',
      latitude: 46.948,
      longitude: 7.447,
    };
    const places = [
      place('zurich', 47, ['z']),
      { ...place('bern', bern.latitude, ['b']), longitude: bern.longitude },
    ];
    const lookup = new Map([
      ['z', 4],
      ['b', 1],
    ]);

    const first = buildLocalityRoutingIndex(
      [ORIGIN, bern],
      places,
      dataset(places),
      lookup,
    );
    const reversedPlaces = places.toReversed();
    const reversedDataset = {
      ...dataset(reversedPlaces),
      profiles: dataset(reversedPlaces).profiles.toReversed(),
    };
    const second = buildLocalityRoutingIndex(
      [bern, ORIGIN],
      reversedPlaces,
      reversedDataset,
      new Map([...lookup].toReversed()),
    );

    expect(second).toEqual(first);
    expect(first.entries.map(({ postalCode }) => postalCode)).toEqual([
      '3011',
      '8001',
    ]);
  });

  it('deduplicates equivalent locality pairs deterministically', () => {
    const duplicate = { ...ORIGIN, city: 'zurich', latitude: 47.01 };
    const places = [place('one', 47, ['active'])];

    const forward = buildLocalityRoutingIndex(
      [ORIGIN, duplicate],
      places,
      dataset(places),
      new Map([['active', 0]]),
    );
    const reverse = buildLocalityRoutingIndex(
      [duplicate, ORIGIN],
      places,
      dataset(places),
      new Map([['active', 0]]),
    );

    expect(forward.entries).toHaveLength(1);
    expect(reverse).toEqual(forward);
  });

  it('loads JSON stop-index arrays back into Uint32Array values', () => {
    const index = parseLocalityRoutingIndexJson(
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            localityId: '8001:zurich',
            postalCode: '8001',
            city: 'Zürich',
            selectionMode: 'WITHIN_ACCESS_RADIUS',
            stopIndexes: [2, 7],
          },
        ],
      }),
    );

    expect(index.entries[0]?.stopIndexes).toBeInstanceOf(Uint32Array);
    expect(index.entries[0]?.stopIndexes).toEqual(new Uint32Array([2, 7]));
  });
});
