import { describe, expect, it } from 'vitest';

import { USE_QUERY_TRANSFER_TIME } from '../../../network/transfer-encoding';
import type { PublicTransportNetwork } from '../../../network';
import {
  arrivalAt,
  runRaptorOneToAll,
  testPattern,
  testTimetable,
  type TestRaptorQuery,
} from './test-timetable';

const DEPARTURE_TIME = 28_800;

const query = (
  overrides: Partial<TestRaptorQuery> = {},
): TestRaptorQuery => ({
  originStopIndexes: [0],
  departureTimeSeconds: DEPARTURE_TIME,
  maxTravelTimeSeconds: 7_200,
  maxTransfers: 1,
  minTransferTimeSeconds: 120,
  ...overrides,
});

const withTransfers = (
  timetable: PublicTransportNetwork,
  edges: readonly (readonly [from: number, to: number, duration: number])[],
): PublicTransportNetwork => {
  const mutable = Array.from(
    { length: timetable.sourceStopIds.length },
    () => [] as number[],
  );
  edges.forEach(([from, to, duration]) => mutable[from]?.push(to, duration));
  return {
    ...timetable,
    transfersByStop: mutable.map((values) => new Uint32Array(values)),
  };
};

const platformChangeNetwork = (
  transferDuration: number,
  onwardDeparture: number,
): PublicTransportNetwork => {
  const arrivingRoute = testPattern([0, 1], [
    [
      { arrival: 28_800, departure: 28_800 },
      { arrival: 30_000, departure: 30_000 },
    ],
  ]);
  const onwardRoute = testPattern([2, 3], [
    [
      { arrival: onwardDeparture, departure: onwardDeparture },
      { arrival: onwardDeparture + 600, departure: onwardDeparture + 600 },
    ],
  ]);
  return withTransfers(testTimetable(4, [arrivingRoute, onwardRoute]), [
    [1, 2, transferDuration],
  ]);
};

describe('RAPTOR transfer routing', () => {
  it('changes between different platform stop IDs', () => {
    const result = runRaptorOneToAll(
      platformChangeNetwork(180, 30_180),
      query(),
    );

    expect(arrivalAt(result, 2)).toBe(30_180);
    expect(arrivalAt(result, 3)).toBe(30_780);
  });

  it('allows the exact transfer boundary and rejects one second too early', () => {
    expect(
      arrivalAt(
        runRaptorOneToAll(
          platformChangeNetwork(180, 30_180),
          query(),
        ),
        3,
      ),
    ).toBe(30_780);
    expect(
      arrivalAt(
        runRaptorOneToAll(
          platformChangeNetwork(180, 30_179),
          query(),
        ),
        3,
      ),
    ).toBeUndefined();
  });

  it('uses an explicit duration instead of the global fallback', () => {
    const result = runRaptorOneToAll(
      platformChangeNetwork(300, 30_200),
      query({ minTransferTimeSeconds: 120 }),
    );

    expect(arrivalAt(result, 2)).toBe(30_300);
    expect(arrivalAt(result, 3)).toBeUndefined();
  });

  it('uses the query minimum for a sibling fallback sentinel', () => {
    const result = runRaptorOneToAll(
      platformChangeNetwork(USE_QUERY_TRANSFER_TIME, 30_120),
      query({ minTransferTimeSeconds: 120 }),
    );

    expect(arrivalAt(result, 2)).toBe(30_120);
    expect(arrivalAt(result, 3)).toBe(30_720);
  });

  it('does not charge the global minimum again after a transfer edge', () => {
    const result = runRaptorOneToAll(
      platformChangeNetwork(180, 30_180),
      query({ minTransferTimeSeconds: 120 }),
    );

    expect(arrivalAt(result, 3)).toBe(30_780);
  });

  it('does not chain two transfer edges without another vehicle', () => {
    const route = testPattern([0, 1], [
      [
        { arrival: 28_800, departure: 28_800 },
        { arrival: 30_000, departure: 30_000 },
      ],
    ]);
    const timetable = withTransfers(testTimetable(4, [route]), [
      [1, 2, 120],
      [2, 3, 120],
    ]);
    const result = runRaptorOneToAll(
      timetable,
      query({ maxTransfers: 0 }),
    );

    expect(arrivalAt(result, 2)).toBe(30_120);
    expect(arrivalAt(result, 3)).toBeUndefined();
  });

  it('does not consume an extra vehicle leg', () => {
    const timetable = platformChangeNetwork(180, 30_180);

    expect(
      arrivalAt(
        runRaptorOneToAll(timetable, query({ maxTransfers: 0 })),
        3,
      ),
    ).toBeUndefined();
    expect(
      arrivalAt(
        runRaptorOneToAll(timetable, query({ maxTransfers: 1 })),
        3,
      ),
    ).toBe(30_780);
  });

  it('prunes transfer arrivals beyond maximum travel time', () => {
    const result = runRaptorOneToAll(
      platformChangeNetwork(180, 30_180),
      query({ maxTravelTimeSeconds: 1_300 }),
    );

    expect(arrivalAt(result, 1)).toBe(30_000);
    expect(arrivalAt(result, 2)).toBeUndefined();
  });

  it('does not traverse transfer edges directly from an origin', () => {
    const timetable = withTransfers(testTimetable(2, []), [[0, 1, 120]]);
    const result = runRaptorOneToAll(
      timetable,
      query({ maxTransfers: 0 }),
    );

    expect(arrivalAt(result, 1)).toBeUndefined();
  });

  it('honors an explicit same-stop minimum instead of query fallback', () => {
    const arrivingRoute = testPattern([0, 1], [
      [
        { arrival: 28_800, departure: 28_800 },
        { arrival: 30_000, departure: 30_000 },
      ],
    ]);
    const tooEarlyOnwardRoute = testPattern([1, 2], [
      [
        { arrival: 30_200, departure: 30_200 },
        { arrival: 30_800, departure: 30_800 },
      ],
    ]);
    const timetable = withTransfers(
      testTimetable(3, [arrivingRoute, tooEarlyOnwardRoute]),
      [[1, 1, 300]],
    );

    expect(
      arrivalAt(
        runRaptorOneToAll(
          timetable,
          query({ minTransferTimeSeconds: 120 }),
        ),
        2,
      ),
    ).toBeUndefined();
  });
  it('produces identical arrival arrays for repeated transfer queries', () => {
    const timetable = platformChangeNetwork(180, 30_180);
    const first = runRaptorOneToAll(timetable, query()).arrivalTimes;

    for (let iteration = 0; iteration < 5; iteration += 1) {
      expect(runRaptorOneToAll(timetable, query()).arrivalTimes).toEqual(first);
    }
  });
});
