import { describe, expect, it } from 'vitest';

import type {
  ExactTimes,
  PickupDropOffType,
  RoutingTrip,
} from '../../../routing-data';
import {
  expandRoutingTrip,
  type ExpandedConcreteTrip,
} from '../expand-frequency-trips';
import {
  getPackedDropOffType,
  getPackedPickupType,
} from '../pickup-dropoff-codec';

const ROUTING_WINDOW_START = 7 * 60 * 60;

const createTrip = ({
  tripId = 'template',
  routeType = 700,
  departures = [28_200, 28_800],
  pickups = [0, 0],
  dropOffs = [0, 0],
  frequency,
}: {
  readonly tripId?: string;
  readonly routeType?: number;
  readonly departures?: readonly number[];
  readonly pickups?: readonly PickupDropOffType[];
  readonly dropOffs?: readonly PickupDropOffType[];
  readonly frequency?: {
    readonly start: number;
    readonly end: number;
    readonly headway: number;
    readonly exactTimes: ExactTimes;
  };
} = {}): RoutingTrip => ({
  tripId,
  routeId: 'route-a',
  routeType,
  stopTimes: departures.map((departure, index) => ({
    stopId: `stop-${index}`,
    stopSequence: index + 1,
    arrivalTimeSeconds: departure - 10,
    departureTimeSeconds: departure,
    pickupType: pickups[index] ?? 0,
    dropOffType: dropOffs[index] ?? 0,
  })),
  frequencyWindows:
    frequency === undefined
      ? []
      : [
          {
            startTimeSeconds: frequency.start,
            endTimeSeconds: frequency.end,
            headwaySeconds: frequency.headway,
            exactTimes: frequency.exactTimes,
          },
        ],
});

const expand = (trip: RoutingTrip) => {
  const concreteTrips: ExpandedConcreteTrip[] = [];
  const counts = expandRoutingTrip(
    trip,
    ROUTING_WINDOW_START,
    (concreteTrip) => concreteTrips.push(concreteTrip),
  );
  return { concreteTrips, counts };
};

describe('expandRoutingTrip', () => {
  it('keeps a scheduled trip as one concrete trip without mode filtering', () => {
    const { concreteTrips, counts } = expand(
      createTrip({ routeType: 700 }),
    );

    expect(concreteTrips).toHaveLength(1);
    expect(concreteTrips[0]?.temporaryTripId).toBe('template');
    expect(concreteTrips[0]?.routeType).toBe(700);
    expect(counts.scheduledConcreteTrips).toBe(1);
  });

  it('does not retain a frequency template as a separate concrete trip', () => {
    const { concreteTrips, counts } = expand(
      createTrip({
        frequency: {
          start: 28_800,
          end: 29_401,
          headway: 300,
          exactTimes: 1,
        },
      }),
    );

    expect(counts.frequencyTemplates).toBe(1);
    expect(concreteTrips).toHaveLength(3);
    expect(concreteTrips.map(({ temporaryTripId }) => temporaryTripId)).not.toContain(
      'template',
    );
  });

  it('generates departures at the headway with an exclusive window end', () => {
    const { concreteTrips } = expand(
      createTrip({
        departures: [28_800, 29_400],
        frequency: {
          start: 28_800,
          end: 29_700,
          headway: 300,
          exactTimes: 1,
        },
      }),
    );

    expect(concreteTrips.map(({ stopTimes }) => stopTimes[1])).toEqual([
      28_800, 29_100, 29_400,
    ]);
  });

  it('shifts every arrival and departure by the same offset', () => {
    const { concreteTrips } = expand(
      createTrip({
        departures: [27_000, 27_900],
        frequency: {
          start: 28_800,
          end: 28_801,
          headway: 600,
          exactTimes: 1,
        },
      }),
    );

    expect(Array.from(concreteTrips[0]?.stopTimes ?? [])).toEqual([
      28_790, 28_800, 29_690, 29_700,
    ]);
  });

  it('preserves every pickup and drop-off value', () => {
    const { concreteTrips } = expand(
      createTrip({
        pickups: [2, 3],
        dropOffs: [3, 1],
        frequency: {
          start: 28_800,
          end: 28_801,
          headway: 60,
          exactTimes: 0,
        },
      }),
    );
    const packed = concreteTrips[0]?.pickupDropOffTypes ?? new Uint8Array();

    expect(getPackedPickupType(packed, 0)).toBe(2);
    expect(getPackedDropOffType(packed, 0)).toBe(3);
    expect(getPackedPickupType(packed, 1)).toBe(3);
    expect(getPackedDropOffType(packed, 1)).toBe(1);
  });

  it.each([0, 1] as const)(
    'expands exact_times=%i deterministically',
    (exactTimes) => {
      const trip = createTrip({
        frequency: {
          start: 28_800,
          end: 29_401,
          headway: 300,
          exactTimes,
        },
      });

      expect(
        expand(trip).concreteTrips.map(({ stopTimes }) =>
          Array.from(stopTimes),
        ),
      ).toEqual(
        expand(trip).concreteTrips.map(({ stopTimes }) =>
          Array.from(stopTimes),
        ),
      );
    },
  );

  it('uses the same deterministic headway approximation for exact and non-exact windows', () => {
    const createFrequencyTrip = (exactTimes: ExactTimes): RoutingTrip =>
      createTrip({
        frequency: {
          start: 28_800,
          end: 29_401,
          headway: 300,
          exactTimes,
        },
      });

    expect(
      expand(createFrequencyTrip(0)).concreteTrips.map(({ stopTimes }) =>
        Array.from(stopTimes),
      ),
    ).toEqual(
      expand(createFrequencyTrip(1)).concreteTrips.map(({ stopTimes }) =>
        Array.from(stopTimes),
      ),
    );
  });

  it('discards generated instances that cannot be boarded at or after the routing-window start', () => {
    const { concreteTrips, counts } = expand(
      createTrip({
        departures: [21_600, 22_200],
        frequency: {
          start: 21_600,
          end: 22_801,
          headway: 600,
          exactTimes: 0,
        },
      }),
    );

    expect(concreteTrips).toEqual([]);
    expect(counts.frequencyInstancesExcludedBeforeRoutingWindow).toBe(3);
  });

  it('retains a complete instance beginning before 07:00 when boardable later', () => {
    const { concreteTrips } = expand(
      createTrip({
        departures: [23_400, 25_800],
        frequency: {
          start: 23_400,
          end: 23_401,
          headway: 600,
          exactTimes: 1,
        },
      }),
    );

    expect(concreteTrips).toHaveLength(1);
    expect(concreteTrips[0]?.stopTimes[1]).toBe(23_400);
    expect(concreteTrips[0]?.stopTimes[3]).toBe(25_800);
  });

  it('keeps GTFS times beyond 24 hours as seconds', () => {
    const { concreteTrips } = expand(
      createTrip({ departures: [86_400, 90_000] }),
    );

    expect(concreteTrips[0]?.stopTimes[3]).toBe(90_000);
  });
});
