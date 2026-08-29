import { describe, expect, it } from 'vitest';

import type { PickupDropOffType } from '../../../prepare/gtfs';
import type { RoutingTrip } from '../../../prepare/routing';
import { buildRaptorTimetable } from '../build-raptor-timetable';
import {
  getDepartureTime,
  getDropOffType,
  getPickupType,
} from '../route-pattern-access';
import type { RaptorTimetable } from '../types';

const ROUTING_WINDOW_START_SECONDS = 7 * 60 * 60;

const buildTimetable = (
  trips: Iterable<RoutingTrip> | AsyncIterable<RoutingTrip>,
): Promise<RaptorTimetable> =>
  buildRaptorTimetable(trips, ROUTING_WINDOW_START_SECONDS);

const trip = ({
  tripId,
  routeId = 'route-a',
  stops = ['stop-a', 'stop-b'],
  departures = [28_800, 29_400],
  pickups = [0, 0],
  dropOffs = [0, 0],
  frequency,
}: {
  readonly tripId: string;
  readonly routeId?: string;
  readonly stops?: readonly string[];
  readonly departures?: readonly number[];
  readonly pickups?: readonly PickupDropOffType[];
  readonly dropOffs?: readonly PickupDropOffType[];
  readonly frequency?: {
    readonly start: number;
    readonly end: number;
    readonly headway: number;
  };
}): RoutingTrip => ({
  tripId,
  routeId,
  stopTimes: stops.map((stopId, index) => ({
    stopId,
    arrivalTimeSeconds: departures[index] ?? 0,
    departureTimeSeconds: departures[index] ?? 0,
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
          },
        ],
});

const snapshot = (timetable: RaptorTimetable): unknown => ({
  sourceStopIds: [...timetable.sourceStopIds],
  patterns: timetable.patterns.map((pattern) => ({
    stops: Array.from(pattern.stops),
    stopTimes: Array.from(pattern.stopTimes),
    pickupDropOffTypes: Array.from(pattern.pickupDropOffTypes),
    tripCount: pattern.tripCount,
  })),
  adjacency: timetable.patternOccurrencesByStop.map((pairs) =>
    Array.from(pairs),
  ),
});

describe('buildRaptorTimetable', () => {
  it('builds deterministic dense stops, typed patterns, and adjacency', async () => {
    const timetable = await buildTimetable([
      trip({
        tripId: 'trip-1',
        stops: ['stop-z', 'opaque:stop-a', 'stop-z'],
        departures: [28_800, 29_000, 29_200],
      }),
    ]);

    expect(timetable.sourceStopIds).toEqual(['opaque:stop-a', 'stop-z']);
    expect(timetable.patterns).toHaveLength(1);
    expect(timetable.patterns[0]?.stops).toEqual(
      new Uint32Array([1, 0, 1]),
    );
    expect(timetable.patterns[0]?.stopTimes).toBeInstanceOf(Uint32Array);
    expect(timetable.patterns[0]?.pickupDropOffTypes).toBeInstanceOf(
      Uint8Array,
    );
    expect(Array.from(timetable.patternOccurrencesByStop[1] ?? [])).toEqual([
      0, 0,
      0, 2,
    ]);
  });

  it('groups ordered trips and splits overtaking trips into safe patterns', async () => {
    const timetable = await buildTimetable([
      trip({ tripId: 'early', departures: [28_800, 30_000] }),
      trip({ tripId: 'overtaker', departures: [29_400, 29_900] }),
    ]);

    expect(timetable.patterns).toHaveLength(2);
  });

  it('expands frequency templates without retaining the template itself', async () => {
    const timetable = await buildTimetable([
      trip({
        tripId: 'frequency-template',
        departures: [28_000, 28_600],
        frequency: {
          start: 28_800,
          end: 29_401,
          headway: 300,
        },
      }),
    ]);

    expect(timetable.patterns[0]?.tripCount).toBe(3);
    expect(getDepartureTime(timetable.patterns[0]!, 0, 0)).toBe(28_800);
    expect(getDepartureTime(timetable.patterns[0]!, 0, 2)).toBe(29_400);
  });

  it('preserves packed pickup/drop-off values in final trip-major order', async () => {
    const timetable = await buildTimetable([
      trip({
        tripId: 'types',
        pickups: [2, 3],
        dropOffs: [3, 1],
      }),
    ]);
    const pattern = timetable.patterns[0]!;

    expect(getPickupType(pattern, 0, 0)).toBe(2);
    expect(getDropOffType(pattern, 0, 0)).toBe(3);
    expect(getPickupType(pattern, 1, 0)).toBe(3);
    expect(getDropOffType(pattern, 1, 0)).toBe(1);
  });

  it('keeps distinct route IDs in separate patterns', async () => {
    const timetable = await buildTimetable([
      trip({ tripId: 'one', routeId: 'route-one' }),
      trip({ tripId: 'two', routeId: 'route-two' }),
      trip({ tripId: 'three', routeId: 'route-three' }),
    ]);

    expect(timetable.patterns).toHaveLength(3);
    expect(
      timetable.patterns.reduce((sum, pattern) => sum + pattern.tripCount, 0),
    ).toBe(3);
  });

  it('accepts an AsyncIterable input and does not mutate it', async () => {
    const trips = [
      trip({ tripId: 'b', departures: [29_400, 30_000] }),
      trip({ tripId: 'a', departures: [28_800, 29_400] }),
    ];
    const before = JSON.stringify(trips);
    async function* stream(): AsyncGenerator<RoutingTrip> {
      for (const routingTrip of trips) {
        yield routingTrip;
      }
    }

    const timetable = await buildTimetable(stream());

    expect(timetable.patterns[0]?.tripCount).toBe(2);
    expect(JSON.stringify(trips)).toBe(before);
  });

  it('produces logically identical output regardless of input order', async () => {
    const trips = [
      trip({ tripId: 'b', routeId: 'route-b', stops: ['z', 'a'] }),
      trip({ tripId: 'a2', routeId: 'route-a', departures: [29_400, 30_000] }),
      trip({ tripId: 'a1', routeId: 'route-a', departures: [28_800, 29_400] }),
    ];

    const forward = await buildTimetable(trips);
    const reverse = await buildTimetable(trips.toReversed());

    expect(snapshot(reverse)).toEqual(snapshot(forward));
  });

  it('does not retain source trip IDs in the hot route-pattern model', async () => {
    const timetable = await buildTimetable([
      trip({ tripId: 'source-trip-id' }),
    ]);

    expect(Object.keys(timetable.patterns[0] ?? {})).toEqual([
      'stops',
      'stopTimes',
      'pickupDropOffTypes',
      'tripCount',
    ]);
    expect(JSON.stringify(snapshot(timetable))).not.toContain(
      'source-trip-id',
    );
  });

  it('returns a valid empty timetable for an empty input stream', async () => {
    const timetable = await buildTimetable([]);

    expect(timetable.sourceStopIds).toEqual([]);
    expect(timetable.patterns).toEqual([]);
    expect(timetable.patternOccurrencesByStop).toEqual([]);
  });
});
