import { describe, expect, it } from 'vitest';

import type { RoutingTrip } from '../../../prepare/routing';
import type { TransitPlace } from '../../../prepare/places';
import { buildRaptorTimetable } from '../../timetable/build-raptor-timetable';
import { collectActiveTransitPlaces } from '../collect-active-transit-places';

const WINDOW_START = 7 * 60 * 60;
const NINE = 9 * 60 * 60;
const NOON = 12 * 60 * 60;

function place(id: string, stopIds: readonly string[]): TransitPlace {
  return { id, name: id, stopIds, latitude: 47, longitude: 8 };
}

function trip(
  tripId: string,
  fromStopId: string,
  toStopId: string,
  departureTimeSeconds: number,
  options: {
    readonly pickupType?: 0 | 1 | 2 | 3;
    readonly dropOffType?: 0 | 1 | 2 | 3;
  } = {},
): RoutingTrip {
  return {
    tripId,
    routeId: `route-${tripId}`,
    stopTimes: [
      {
        stopId: fromStopId,
        arrivalTimeSeconds: departureTimeSeconds,
        departureTimeSeconds,
        pickupType: options.pickupType ?? 0,
        dropOffType: 0,
      },
      {
        stopId: toStopId,
        arrivalTimeSeconds: departureTimeSeconds + 600,
        departureTimeSeconds: departureTimeSeconds + 600,
        pickupType: 0,
        dropOffType: options.dropOffType ?? 0,
      },
    ],
    frequencyWindows: [],
  };
}

describe('collectActiveTransitPlaces', () => {
  it('keeps only places with a boardable window trip to another place', async () => {
    const places = [
      place('morning', ['morning-stop']),
      place('destination', ['destination-stop']),
      place('night', ['night-stop']),
      place('same-place', ['same-a', 'same-b']),
      place('no-pickup', ['no-pickup-stop']),
      place('no-drop-off', ['no-drop-off-stop']),
      place('blocked-destination', ['blocked-destination-stop']),
    ];
    const timetable = await buildRaptorTimetable(
      [
        trip('morning', 'morning-stop', 'destination-stop', 8 * 60 * 60),
        trip('night', 'night-stop', 'destination-stop', 23 * 60 * 60),
        trip('same', 'same-a', 'same-b', 8 * 60 * 60),
        trip(
          'no-pickup',
          'no-pickup-stop',
          'destination-stop',
          8 * 60 * 60,
          { pickupType: 1 },
        ),
        trip(
          'no-drop-off',
          'no-drop-off-stop',
          'blocked-destination-stop',
          8 * 60 * 60,
          { dropOffType: 1 },
        ),
      ],
      WINDOW_START,
    );

    expect(
      collectActiveTransitPlaces(
        places,
        timetable,
        new Map(timetable.patterns.map(({ routeId }) => [routeId, false])),
        WINDOW_START,
        NINE,
      ).map(({ id }) => id),
    ).toEqual(['morning']);
  });

  it('admits later service when the window is extended but keeps noon exclusive', async () => {
    const places = [
      place('after-nine', ['after-nine-stop']),
      place('at-noon', ['at-noon-stop']),
      place('destination', ['destination-stop']),
    ];
    const timetable = await buildRaptorTimetable(
      [
        trip('after-nine', 'after-nine-stop', 'destination-stop', 10 * 60 * 60),
        trip('at-noon', 'at-noon-stop', 'destination-stop', NOON),
      ],
      WINDOW_START,
    );

    expect(
      collectActiveTransitPlaces(
        places,
        timetable,
        new Map(timetable.patterns.map(({ routeId }) => [routeId, false])),
        WINDOW_START,
        NINE,
      ),
    ).toEqual([]);
    expect(
      collectActiveTransitPlaces(
        places,
        timetable,
        new Map(timetable.patterns.map(({ routeId }) => [routeId, false])),
        WINDOW_START,
        NOON,
      ).map(({ id }) => id),
    ).toEqual(['after-nine']);
  });
});

describe('station activity counts', () => {
  it('counts expanded trips once per physical station and rail departures only in the window', async () => {
    const places = [place('station', ['a', 'a-platform']), place('destination', ['b'])];
    const rail = trip('rail', 'a', 'b', 8 * 3600);
    const railWithPlatforms: RoutingTrip = {
      ...rail,
      stopTimes: [rail.stopTimes[0]!, {
        ...rail.stopTimes[0]!, stopId: 'a-platform',
        arrivalTimeSeconds: 8 * 3600 + 60, departureTimeSeconds: 8 * 3600 + 60,
      }, rail.stopTimes[1]!],
    };
    const frequency: RoutingTrip = {
      ...trip('frequency', 'a', 'b', 0),
      frequencyWindows: [{ startTimeSeconds: WINDOW_START,
        endTimeSeconds: 8 * 3600, headwaySeconds: 1800 }],
    };
    const timetable = await buildRaptorTimetable([
      railWithPlatforms, trip('bus', 'a', 'b', 8 * 3600 + 900), frequency,
      trip('late-rail', 'a', 'b', NOON), trip('early-rail', 'a', 'b', WINDOW_START - 1),
    ], WINDOW_START);
    const railByRouteId = new Map(timetable.patterns.map(({ routeId }) => [
      routeId, routeId.includes('rail'),
    ]));
    expect(collectActiveTransitPlaces(places, timetable, railByRouteId, WINDOW_START, NOON))
      .toEqual([{ ...places[0], departureCount: 4, railDepartureCount: 1 }]);
  });

  it('allows alighting after the window when boarding before its end', async () => {
    const places = [place('a', ['a']), place('b', ['b'])];
    const timetable = await buildRaptorTimetable([trip('rail', 'a', 'b', NOON - 1)], WINDOW_START);
    expect(collectActiveTransitPlaces(places, timetable, new Map([['route-rail', true]]),
      WINDOW_START, NOON)).toEqual([{ ...places[0], departureCount: 1, railDepartureCount: 1 }]);
  });

  it('rejects unknown route metadata and ambiguous physical station membership', async () => {
    const places = [place('a', ['a']), place('b', ['b'])];
    const timetable = await buildRaptorTimetable([trip('bus', 'a', 'b', WINDOW_START)], WINDOW_START);
    expect(() => collectActiveTransitPlaces(places, timetable, new Map(), WINDOW_START, NOON))
      .toThrow(/missing from routes.txt/);
    expect(() => collectActiveTransitPlaces([...places, place('duplicate', ['a'])],
      timetable, new Map(), WINDOW_START, NOON)).toThrow(/belongs to both/);
  });
});
