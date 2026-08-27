import { describe, expect, it } from 'vitest';

import { scanPattern } from '../scan-pattern';
import {
  createUnreachedArrivalTimes,
  UNREACHED_TIME,
  type PatternScanState,
} from '../state';
import { testPattern } from './test-timetable';

const createState = ({
  stopCount,
  previousArrivals,
  roundNumber = 1,
  minTransferTimeSeconds = 120,
  maxArrivalTime = 40_000,
}: {
  readonly stopCount: number;
  readonly previousArrivals: readonly [stop: number, arrival: number][];
  readonly roundNumber?: number;
  readonly minTransferTimeSeconds?: number;
  readonly maxArrivalTime?: number;
}): PatternScanState => {
  const previousRoundArrivalTimes = createUnreachedArrivalTimes(stopCount);
  const previousRoundTransferApplied = new Uint8Array(stopCount);
  previousArrivals.forEach(([stop, arrival]) => {
    previousRoundArrivalTimes[stop] = arrival;
  });
  return {
    globalArrivalTimes: createUnreachedArrivalTimes(stopCount),
    globalBoardingReadyTimes: createUnreachedArrivalTimes(stopCount),
    bestVehicleArrivalTimes: createUnreachedArrivalTimes(stopCount),
    previousRoundArrivalTimes,
    previousRoundTransferApplied,
    currentRoundArrivalTimes: createUnreachedArrivalTimes(stopCount),
    currentRoundTransferApplied: new Uint8Array(stopCount),
    currentRoundVehicleArrivalTimes:
      createUnreachedArrivalTimes(stopCount),
    vehicleImprovedStops: [],
    vehicleImprovedMembership: new Uint8Array(stopCount),
    transfersByStop: Array.from(
      { length: stopCount },
      () => new Uint32Array(),
    ),
    nextMarkedStops: [],
    nextMarkedMembership: new Uint8Array(stopCount),
    roundNumber,
    minTransferTimeSeconds,
    maxArrivalTime,
  };
};

describe('scanPattern', () => {
  it('uses binary search to skip a trip departing before the query', () => {
    const pattern = testPattern(
      [0, 1],
      [
        [
          { arrival: 28_000, departure: 28_000 },
          { arrival: 28_500, departure: 28_500 },
        ],
        [
          { arrival: 29_100, departure: 29_100 },
          { arrival: 29_700, departure: 29_700 },
        ],
      ],
    );
    const state = createState({
      stopCount: 2,
      previousArrivals: [[0, 28_800]],
    });

    scanPattern(pattern, 0, state);

    expect(state.globalArrivalTimes[1]).toBe(29_700);
  });

  it('allows boarding at the exact earliest time without initial transfer time', () => {
    const pattern = testPattern([0, 1], [
      [
        { arrival: 28_800, departure: 28_800 },
        { arrival: 29_400, departure: 29_400 },
      ],
    ]);
    const state = createState({
      stopCount: 2,
      previousArrivals: [[0, 28_800]],
      minTransferTimeSeconds: 600,
    });

    scanPattern(pattern, 0, state);

    expect(state.globalArrivalTimes[1]).toBe(29_400);
  });

  it('does not mark a stop where drop-off is prohibited', () => {
    const pattern = testPattern([0, 1, 2], [
      [
        { arrival: 28_800, departure: 28_800 },
        { arrival: 29_400, departure: 29_400, dropOffType: 1 },
        { arrival: 30_000, departure: 30_000 },
      ],
    ]);
    const state = createState({
      stopCount: 3,
      previousArrivals: [[0, 28_800]],
    });

    scanPattern(pattern, 0, state);

    expect(state.globalArrivalTimes[1]).toBe(UNREACHED_TIME);
    expect(state.globalArrivalTimes[2]).toBe(30_000);
  });

  it('skips pickup-prohibited trips and boards the next eligible trip', () => {
    const pattern = testPattern(
      [0, 1],
      [
        [
          { arrival: 28_800, departure: 28_800, pickupType: 1 },
          { arrival: 29_200, departure: 29_200 },
        ],
        [
          { arrival: 28_900, departure: 28_900 },
          { arrival: 29_400, departure: 29_400 },
        ],
      ],
    );
    const state = createState({
      stopCount: 2,
      previousArrivals: [[0, 28_800]],
    });

    scanPattern(pattern, 0, state);

    expect(state.globalArrivalTimes[1]).toBe(29_400);
  });

  it.each([2, 3] as const)(
    'keeps pickup type %i boardable',
    (pickupType) => {
      const pattern = testPattern([0, 1], [
        [
          { arrival: 28_800, departure: 28_800, pickupType },
          { arrival: 29_400, departure: 29_400 },
        ],
      ]);
      const state = createState({
        stopCount: 2,
        previousArrivals: [[0, 28_800]],
      });

      scanPattern(pattern, 0, state);

      expect(state.globalArrivalTimes[1]).toBe(29_400);
    },
  );

  it('switches from a later active trip to an earlier trip downstream', () => {
    const pattern = testPattern(
      [0, 1, 2],
      [
        [
          { arrival: 28_800, departure: 28_800 },
          { arrival: 29_100, departure: 29_200 },
          { arrival: 30_000, departure: 30_000 },
        ],
        [
          { arrival: 29_000, departure: 29_100 },
          { arrival: 29_300, departure: 29_400 },
          { arrival: 30_600, departure: 30_600 },
        ],
      ],
    );
    const state = createState({
      stopCount: 3,
      previousArrivals: [
        [0, 29_000],
        [1, 29_100],
      ],
    });

    scanPattern(pattern, 0, state);

    expect(state.globalArrivalTimes[2]).toBe(30_000);
  });

  it('handles equal departures deterministically by choosing the first trip', () => {
    const pattern = testPattern(
      [0, 1],
      [
        [
          { arrival: 28_800, departure: 28_800 },
          { arrival: 29_300, departure: 29_300 },
        ],
        [
          { arrival: 28_800, departure: 28_800 },
          { arrival: 29_400, departure: 29_400 },
        ],
      ],
    );
    const state = createState({
      stopCount: 2,
      previousArrivals: [[0, 28_800]],
    });

    scanPattern(pattern, 0, state);

    expect(state.globalArrivalTimes[1]).toBe(29_300);
  });
});
