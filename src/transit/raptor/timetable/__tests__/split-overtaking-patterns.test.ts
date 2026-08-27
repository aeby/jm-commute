import { describe, expect, it } from 'vitest';

import type { GroupedConcreteTrip } from '../group-route-patterns';
import {
  splitOvertakingTrips,
  validateNonOvertakingTripChain,
} from '../split-overtaking-patterns';

const trip = (
  temporaryTripId: string,
  times: readonly (readonly [arrival: number, departure: number])[],
): GroupedConcreteTrip => ({
  temporaryTripId,
  stopTimes: new Uint32Array(times.flat()),
  pickupDropOffTypes: new Uint8Array(Math.ceil(times.length / 2)),
});

const ids = (chains: readonly GroupedConcreteTrip[][]): readonly string[][] =>
  chains.map((chain) => chain.map(({ temporaryTripId }) => temporaryTripId));

describe('splitOvertakingTrips', () => {
  it('keeps normally ordered trips in one pattern', () => {
    const chains = splitOvertakingTrips(
      [
        trip('early', [
          [100, 100],
          [200, 200],
        ]),
        trip('late', [
          [110, 110],
          [210, 210],
        ]),
      ],
      2,
    );

    expect(ids(chains)).toEqual([['early', 'late']]);
  });

  it('allows equality at every stop', () => {
    const equalTimes = [
      [100, 100],
      [200, 200],
    ] as const;
    const chains = splitOvertakingTrips(
      [trip('b', equalTimes), trip('a', equalTimes)],
      2,
    );

    expect(ids(chains)).toEqual([['a', 'b']]);
  });

  it('splits a later departure that arrives before an earlier trip', () => {
    const chains = splitOvertakingTrips(
      [
        trip('early', [
          [100, 100],
          [240, 240],
        ]),
        trip('overtaker', [
          [110, 110],
          [230, 230],
        ]),
      ],
      2,
    );

    expect(ids(chains)).toEqual([['early'], ['overtaker']]);
  });

  it('detects overtaking at an intermediate stop', () => {
    const chains = splitOvertakingTrips(
      [
        trip('early', [
          [100, 100],
          [220, 220],
          [300, 300],
        ]),
        trip('later', [
          [110, 110],
          [210, 210],
          [310, 310],
        ]),
      ],
      3,
    );

    expect(chains).toHaveLength(2);
  });

  it('detects a departure-order inversion even when arrivals remain ordered', () => {
    const chains = splitOvertakingTrips(
      [
        trip('early', [
          [100, 100],
          [200, 230],
        ]),
        trip('later', [
          [110, 110],
          [220, 220],
        ]),
      ],
      2,
    );

    expect(chains).toHaveLength(2);
  });

  it('creates several patterns when several trips overtake', () => {
    const chains = splitOvertakingTrips(
      [
        trip('a', [
          [100, 100],
          [300, 300],
        ]),
        trip('b', [
          [110, 110],
          [290, 290],
        ]),
        trip('c', [
          [120, 120],
          [280, 280],
        ]),
      ],
      2,
    );

    expect(chains).toHaveLength(3);
  });

  it('produces only chains that pass a second non-overtaking validation', () => {
    const chains = splitOvertakingTrips(
      [
        trip('a', [
          [100, 100],
          [300, 300],
        ]),
        trip('b', [
          [110, 110],
          [290, 290],
        ]),
        trip('c', [
          [120, 120],
          [310, 310],
        ]),
      ],
      2,
    );

    chains.forEach((chain) => {
      expect(() => validateNonOvertakingTripChain(chain, 2)).not.toThrow();
    });
  });

  it('is deterministic regardless of input order', () => {
    const trips = [
      trip('a', [
        [100, 100],
        [300, 300],
      ]),
      trip('b', [
        [110, 110],
        [290, 290],
      ]),
      trip('c', [
        [120, 120],
        [310, 310],
      ]),
    ];

    expect(ids(splitOvertakingTrips(trips.toReversed(), 2))).toEqual(
      ids(splitOvertakingTrips(trips, 2)),
    );
  });

  it('prefers the compatible chain with the latest first-stop departure', () => {
    const chains = splitOvertakingTrips(
      [
        trip('chain-a', [
          [100, 100],
          [300, 300],
        ]),
        trip('chain-b', [
          [110, 110],
          [290, 290],
        ]),
        trip('compatible-with-both', [
          [120, 120],
          [310, 310],
        ]),
      ],
      2,
    );

    expect(ids(chains)).toEqual([
      ['chain-a'],
      ['chain-b', 'compatible-with-both'],
    ]);
  });

  it('does not split an already non-overtaking dataset unnecessarily', () => {
    const trips = Array.from({ length: 20 }, (_, index) =>
      trip(`trip-${index.toString().padStart(2, '0')}`, [
        [100 + index, 100 + index],
        [200 + index, 200 + index],
      ]),
    );

    expect(splitOvertakingTrips(trips, 2)).toHaveLength(1);
  });
});
