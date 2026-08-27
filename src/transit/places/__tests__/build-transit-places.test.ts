import { describe, expect, it } from 'vitest';

import type { TransitStop } from '../../stops';
import { buildTransitPlaces } from '../build-transit-places';

const STATION_WITH_PLATFORMS: readonly TransitStop[] = [
  {
    id: 'platform-2',
    name: 'Platform name 2',
    latitude: 47.3782,
    longitude: 8.5402,
    kind: 'STOP_OR_PLATFORM',
    parentStationId: 'station-zurich',
  },
  {
    id: 'station-zurich',
    name: 'Zürich HB',
    latitude: 47.378,
    longitude: 8.54,
    kind: 'STATION',
  },
  {
    id: 'platform-1',
    name: 'Platform name 1',
    latitude: 47.3779,
    longitude: 8.5399,
    kind: 'STOP_OR_PLATFORM',
    parentStationId: 'station-zurich',
  },
];

describe('buildTransitPlaces', () => {
  it('builds one place from a station and its sorted child platforms', () => {
    expect(buildTransitPlaces(STATION_WITH_PLATFORMS)).toEqual([
      {
        id: 'station-zurich',
        name: 'Zürich HB',
        latitude: 47.378,
        longitude: 8.54,
        stopIds: ['platform-1', 'platform-2'],
      },
    ]);
  });

  it('does not return child platforms as separate places', () => {
    const placeIds = buildTransitPlaces(STATION_WITH_PLATFORMS).map(
      ({ id }) => id,
    );

    expect(placeIds).not.toContain('platform-1');
    expect(placeIds).not.toContain('platform-2');
  });

  it('builds a standalone stop with its own ID as its routing stop', () => {
    const stop: TransitStop = {
      id: 'village-bus-stop',
      name: 'Example Village, Post',
      latitude: 46.9,
      longitude: 8.1,
      kind: 'STOP_OR_PLATFORM',
    };

    expect(buildTransitPlaces([stop])).toEqual([
      {
        id: 'village-bus-stop',
        name: 'Example Village, Post',
        latitude: 46.9,
        longitude: 8.1,
        stopIds: ['village-bus-stop'],
      },
    ]);
  });

  it('excludes a station without child stops', () => {
    const station: TransitStop = {
      id: 'empty-station',
      name: 'Empty Station',
      latitude: 47,
      longitude: 8,
      kind: 'STATION',
    };

    expect(buildTransitPlaces([station])).toEqual([]);
  });

  it('groups multiple stations independently', () => {
    const stops: readonly TransitStop[] = [
      {
        id: 'station-b',
        name: 'Station B',
        latitude: 47.2,
        longitude: 8.2,
        kind: 'STATION',
      },
      {
        id: 'platform-a',
        name: 'Station A platform',
        latitude: 47.11,
        longitude: 8.11,
        kind: 'STOP_OR_PLATFORM',
        parentStationId: 'station-a',
      },
      {
        id: 'station-a',
        name: 'Station A',
        latitude: 47.1,
        longitude: 8.1,
        kind: 'STATION',
      },
      {
        id: 'platform-b',
        name: 'Station B platform',
        latitude: 47.21,
        longitude: 8.21,
        kind: 'STOP_OR_PLATFORM',
        parentStationId: 'station-b',
      },
    ];

    expect(buildTransitPlaces(stops)).toEqual([
      {
        id: 'station-a',
        name: 'Station A',
        latitude: 47.1,
        longitude: 8.1,
        stopIds: ['platform-a'],
      },
      {
        id: 'station-b',
        name: 'Station B',
        latitude: 47.2,
        longitude: 8.2,
        stopIds: ['platform-b'],
      },
    ]);
  });

  it('sorts station and standalone results by ID', () => {
    const standaloneStop: TransitStop = {
      id: 'standalone-a',
      name: 'Standalone A',
      latitude: 46,
      longitude: 7,
      kind: 'STOP_OR_PLATFORM',
    };

    expect(
      buildTransitPlaces([...STATION_WITH_PLATFORMS, standaloneStop]).map(
        ({ id }) => id,
      ),
    ).toEqual(['standalone-a', 'station-zurich']);
  });

  it('does not mutate the input array or its objects', () => {
    const input = structuredClone(STATION_WITH_PLATFORMS);
    const originalInput = structuredClone(input);

    buildTransitPlaces(input);

    expect(input).toEqual(originalInput);
  });

  it('returns the same result regardless of input order', () => {
    const forward = buildTransitPlaces(STATION_WITH_PLATFORMS);
    const reversed = buildTransitPlaces(
      STATION_WITH_PLATFORMS.toReversed(),
    );

    expect(reversed).toEqual(forward);
    expect(buildTransitPlaces(STATION_WITH_PLATFORMS)).toEqual(forward);
  });
});
