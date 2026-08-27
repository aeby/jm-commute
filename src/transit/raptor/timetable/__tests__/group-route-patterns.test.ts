import { describe, expect, it } from 'vitest';

import type { ExpandedConcreteTrip } from '../expand-frequency-trips';
import { groupRoutePatternTrips } from '../group-route-patterns';

const concreteTrip = (
  temporaryTripId: string,
  routeId: string,
  sourceStopIds: readonly string[],
  firstDeparture = 28_800,
): ExpandedConcreteTrip => ({
  temporaryTripId,
  routeId,
  routeType: 700,
  sourceStopIds,
  stopTimes: new Uint32Array(
    sourceStopIds.flatMap((_, index) => [
      firstDeparture + index * 60,
      firstDeparture + index * 60,
    ]),
  ),
  pickupDropOffTypes: new Uint8Array(Math.ceil(sourceStopIds.length / 2)),
});

const summarize = (
  trips: readonly ExpandedConcreteTrip[],
): readonly unknown[] =>
  groupRoutePatternTrips(trips).map((group) => ({
    routeId: group.routeId,
    stops: [...group.sourceStopIds],
    trips: group.trips.map(({ temporaryTripId }) => temporaryTripId),
  }));

describe('groupRoutePatternTrips', () => {
  it('groups identical route and ordered stop sequences together', () => {
    const groups = groupRoutePatternTrips([
      concreteTrip('trip-b', 'route-1', ['a', 'b'], 29_400),
      concreteTrip('trip-a', 'route-1', ['a', 'b'], 28_800),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.trips.map(({ temporaryTripId }) => temporaryTripId)).toEqual(
      ['trip-a', 'trip-b'],
    );
  });

  it('keeps identical stop sequences on different routes separate', () => {
    const groups = groupRoutePatternTrips([
      concreteTrip('a', 'route-1', ['a', 'b']),
      concreteTrip('b', 'route-2', ['a', 'b']),
    ]);

    expect(groups.map(({ routeId }) => routeId)).toEqual([
      'route-1',
      'route-2',
    ]);
  });

  it('separates different and reversed stop sequences', () => {
    const groups = groupRoutePatternTrips([
      concreteTrip('a', 'route', ['a', 'b', 'c']),
      concreteTrip('b', 'route', ['a', 'x', 'c']),
      concreteTrip('c', 'route', ['c', 'b', 'a']),
    ]);

    expect(groups.map(({ sourceStopIds }) => sourceStopIds)).toEqual([
      ['a', 'b', 'c'],
      ['a', 'x', 'c'],
      ['c', 'b', 'a'],
    ]);
  });

  it('preserves repeated stops in a sequence', () => {
    const groups = groupRoutePatternTrips([
      concreteTrip('loop', 'route', ['a', 'b', 'a']),
    ]);

    expect(groups[0]?.sourceStopIds).toEqual(['a', 'b', 'a']);
  });

  it('does not let input ordering affect deterministic group output', () => {
    const trips = [
      concreteTrip('z', 'route-b', ['q', 'r'], 30_000),
      concreteTrip('a', 'route-a', ['a', 'b'], 28_800),
      concreteTrip('b', 'route-a', ['a', 'b'], 29_000),
      concreteTrip('x', 'route-a', ['b', 'a'], 28_900),
    ];

    expect(summarize(trips.toReversed())).toEqual(summarize(trips));
  });
});
