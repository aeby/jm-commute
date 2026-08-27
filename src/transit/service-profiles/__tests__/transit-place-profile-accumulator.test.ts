import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../../../config';
import type { TransitPlace } from '../../places';
import { buildStopToPlaceMap } from '../build-stop-to-place-map';
import { parseGtfsTimeToSeconds } from '../parse-gtfs-time';
import { createTransitPlaceProfileAccumulator } from '../transit-place-profile-accumulator';

const REFERENCE_SCENARIO = PROJECT_CONFIG.transit.referenceScenario;
const WINDOW_START = parseGtfsTimeToSeconds(
  REFERENCE_SCENARIO.morningWindow.start,
);
const WINDOW_END = parseGtfsTimeToSeconds(
  REFERENCE_SCENARIO.morningWindow.end,
);

const PLACES: readonly TransitPlace[] = [
  {
    id: 'station-b',
    name: 'Station B',
    latitude: 47.2,
    longitude: 8.2,
    stopIds: ['platform-b-2', 'platform-b-1'],
  },
  {
    id: 'empty-place',
    name: 'Empty Place',
    latitude: 47.3,
    longitude: 8.3,
    stopIds: ['empty-stop'],
  },
  {
    id: 'stop-a',
    name: 'Stop A',
    latitude: 47.1,
    longitude: 8.1,
    stopIds: ['stop-a'],
  },
];

const ACTIVE_TRIPS = new Map([
  ['bus-trip', { routeId: 'bus-route', isRail: false }],
  ['other-bus-trip', { routeId: 'other-bus-route', isRail: false }],
  ['rail-trip', { routeId: 'rail-route', isRail: true }],
  ['second-rail-trip', { routeId: 'second-rail-route', isRail: true }],
]);

function createAccumulator() {
  return createTransitPlaceProfileAccumulator(
    PLACES,
    ACTIVE_TRIPS,
    WINDOW_START,
    WINDOW_END,
  );
}

function stopTime(
  overrides: Readonly<Record<string, string>> = {},
) {
  return {
    tripId: 'bus-trip',
    departureTime: '08:00:00',
    stopId: 'stop-a',
    pickupType: '0',
    ...overrides,
  };
}

describe('createTransitPlaceProfileAccumulator', () => {
  it('counts only active trips', () => {
    const accumulator = createAccumulator();

    expect(
      accumulator.addStopTime(
        stopTime({
          tripId: 'inactive-trip',
          departureTime: 'malformed',
          stopId: 'unknown-stop',
        }),
      ),
    ).toBe(false);
    expect(
      accumulator.addStopTime(stopTime({ tripId: 'bus-trip' })),
    ).toBe(true);
    expect(
      accumulator
        .buildProfiles()
        .find(({ placeId }) => placeId === 'stop-a')?.departureCount,
    ).toBe(1);
  });

  it('ignores a blank departure time on an active trip', () => {
    const accumulator = createAccumulator();

    expect(
      accumulator.addStopTime(stopTime({ departureTime: ' ' })),
    ).toBe(false);
    expect(
      accumulator
        .buildProfiles()
        .find(({ placeId }) => placeId === 'stop-a')?.departureCount,
    ).toBe(0);
  });

  it('includes the window start and excludes the window end', () => {
    const accumulator = createAccumulator();

    expect(
      accumulator.addStopTime(stopTime({ departureTime: '08:59:59' })),
    ).toBe(true);
    expect(
      accumulator.addStopTime(
        stopTime({
          departureTime: REFERENCE_SCENARIO.morningWindow.start,
        }),
      ),
    ).toBe(true);
    expect(
      accumulator.addStopTime(
        stopTime({
          departureTime: REFERENCE_SCENARIO.morningWindow.end,
        }),
      ),
    ).toBe(false);
    expect(
      accumulator
        .buildProfiles()
        .find(({ placeId }) => placeId === 'stop-a')?.departureCount,
    ).toBe(2);
  });

  it('counts empty and zero pickup types', () => {
    const accumulator = createAccumulator();

    accumulator.addStopTime(stopTime({ pickupType: '' }));
    accumulator.addStopTime(stopTime({ pickupType: '0' }));

    expect(
      accumulator
        .buildProfiles()
        .find(({ placeId }) => placeId === 'stop-a')?.departureCount,
    ).toBe(2);
  });

  it.each(['1', '2', '3'])(
    'ignores pickup type %s',
    (pickupType) => {
      const accumulator = createAccumulator();

      expect(
        accumulator.addStopTime(stopTime({ pickupType })),
      ).toBe(false);
      expect(
        accumulator
          .buildProfiles()
          .find(({ placeId }) => placeId === 'stop-a')?.departureCount,
      ).toBe(0);
    },
  );

  it('aggregates child-platform departures into one transit place', () => {
    const accumulator = createAccumulator();

    accumulator.addStopTime(stopTime({ stopId: 'platform-b-2' }));
    accumulator.addStopTime(stopTime({ stopId: 'platform-b-1' }));

    expect(
      accumulator
        .buildProfiles()
        .find(({ placeId }) => placeId === 'station-b'),
    ).toEqual({
      placeId: 'station-b',
      departureCount: 2,
      routeCount: 1,
      railDepartureCount: 0,
      railRouteCount: 0,
    });
  });

  it('counts departures and unique routes independently', () => {
    const accumulator = createAccumulator();

    accumulator.addStopTime(stopTime());
    accumulator.addStopTime(stopTime());
    accumulator.addStopTime(stopTime({ tripId: 'other-bus-trip' }));

    expect(
      accumulator
        .buildProfiles()
        .find(({ placeId }) => placeId === 'stop-a'),
    ).toMatchObject({ departureCount: 3, routeCount: 2 });
  });

  it('calculates railway departures and routes independently', () => {
    const accumulator = createAccumulator();

    accumulator.addStopTime(stopTime());
    accumulator.addStopTime(stopTime({ tripId: 'rail-trip' }));
    accumulator.addStopTime(stopTime({ tripId: 'rail-trip' }));
    accumulator.addStopTime(stopTime({ tripId: 'second-rail-trip' }));

    expect(
      accumulator
        .buildProfiles()
        .find(({ placeId }) => placeId === 'stop-a'),
    ).toEqual({
      placeId: 'stop-a',
      departureCount: 4,
      routeCount: 3,
      railDepartureCount: 3,
      railRouteCount: 2,
    });
  });

  it('includes zero-count profiles and sorts every profile by place ID', () => {
    const profiles = createAccumulator().buildProfiles();

    expect(profiles.map(({ placeId }) => placeId)).toEqual([
      'empty-place',
      'station-b',
      'stop-a',
    ]);
    expect(profiles[0]).toEqual({
      placeId: 'empty-place',
      departureCount: 0,
      routeCount: 0,
      railDepartureCount: 0,
      railRouteCount: 0,
    });
    expect(Object.isFrozen(profiles)).toBe(true);
    expect(Object.isFrozen(profiles[0])).toBe(true);
  });

  it('rejects unknown stops referenced by active qualifying trips', () => {
    const accumulator = createAccumulator();

    expect(() =>
      accumulator.addStopTime(stopTime({ stopId: 'unknown-stop' })),
    ).toThrow(/active trip.*unknown GTFS stop ID "unknown-stop"/i);
  });
});

describe('buildStopToPlaceMap', () => {
  it('maps each child stop ID to its logical transit-place ID', () => {
    expect(buildStopToPlaceMap(PLACES)).toEqual(
      new Map([
        ['platform-b-2', 'station-b'],
        ['platform-b-1', 'station-b'],
        ['empty-stop', 'empty-place'],
        ['stop-a', 'stop-a'],
      ]),
    );
  });

  it('rejects a stop ID assigned to multiple transit places', () => {
    const duplicateStopPlaces: readonly TransitPlace[] = [
      {
        id: 'place-a',
        name: 'Place A',
        latitude: 47,
        longitude: 8,
        stopIds: ['duplicate-stop'],
      },
      {
        id: 'place-b',
        name: 'Place B',
        latitude: 47,
        longitude: 8,
        stopIds: ['duplicate-stop'],
      },
    ];

    expect(() => buildStopToPlaceMap(duplicateStopPlaces)).toThrow(
      /stop ID "duplicate-stop".*both transit place/i,
    );
  });

  it('rejects duplicate place IDs', () => {
    const duplicatePlaceIds: readonly TransitPlace[] = [
      {
        id: 'duplicate-place',
        name: 'First',
        latitude: 47,
        longitude: 8,
        stopIds: ['first-stop'],
      },
      {
        id: 'duplicate-place',
        name: 'Second',
        latitude: 47,
        longitude: 8,
        stopIds: ['second-stop'],
      },
    ];

    expect(() => buildStopToPlaceMap(duplicatePlaceIds)).toThrow(
      /duplicate transit-place ID/i,
    );
  });

  it('rejects places without a usable stop ID', () => {
    const placeWithoutStops: TransitPlace = {
      id: 'empty',
      name: 'Empty',
      latitude: 47,
      longitude: 8,
      stopIds: [],
    };
    const placeWithBlankStop: TransitPlace = {
      ...placeWithoutStops,
      id: 'blank',
      stopIds: [' '],
    };

    expect(() => buildStopToPlaceMap([placeWithoutStops])).toThrow(
      /at least one stop ID/i,
    );
    expect(() => buildStopToPlaceMap([placeWithBlankStop])).toThrow(
      /invalid empty stop ID/i,
    );
  });
});
