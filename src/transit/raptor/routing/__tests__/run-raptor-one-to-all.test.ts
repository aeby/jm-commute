import { describe, expect, it } from 'vitest';

import { UNREACHED_TIME } from '../state';
import type {
  RaptorQuery,
  RaptorRoutingDiagnostics,
} from '../types';
import {
  arrivalAt,
  runRaptorOneToAll,
  testPattern,
  testTimetable,
  travelTimeTo,
} from './test-timetable';

const DEPARTURE_TIME = 28_800;

const query = (
  overrides: Partial<RaptorQuery> = {},
): RaptorQuery => ({
  originStopIndexes: [0],
  departureTimeSeconds: DEPARTURE_TIME,
  maxTravelTimeSeconds: 7_200,
  maxTransfers: 5,
  minTransferTimeSeconds: 120,
  ...overrides,
});

const transferNetwork = () => {
  const routeA = testPattern([0, 1, 2], [
    [
      { arrival: 29_100, departure: 29_100 },
      { arrival: 29_700, departure: 29_700 },
      { arrival: 30_300, departure: 30_300 },
    ],
  ]);
  const routeB = testPattern([1, 3, 4], [
    [
      { arrival: 30_000, departure: 30_000 },
      { arrival: 30_900, departure: 30_900 },
      { arrival: 31_500, departure: 31_500 },
    ],
  ]);
  return testTimetable(5, [routeA, routeB]);
};

const durationTimetable = (arrival: number, departure = 28_800) =>
  testTimetable(2, [
    testPattern([0, 1], [
      [
        { arrival: departure, departure },
        { arrival, departure: arrival },
      ],
    ]),
  ]);

describe('runRaptorOneToAll origins', () => {
  it('seeds one origin at the query departure time', () => {
    const result = runRaptorOneToAll(transferNetwork(), query());

    expect(arrivalAt(result, 0)).toBe(DEPARTURE_TIME);
  });

  it('seeds several origins at the same departure time', () => {
    const result = runRaptorOneToAll(
      transferNetwork(),
      query({ originStopIndexes: [0, 3] }),
    );

    expect(arrivalAt(result, 0)).toBe(DEPARTURE_TIME);
    expect(arrivalAt(result, 3)).toBe(DEPARTURE_TIME);
    expect(arrivalAt(result, 4)).toBe(31_500);
  });

  it('deduplicates repeated origins harmlessly', () => {
    const timetable = transferNetwork();
    const unique = runRaptorOneToAll(
      timetable,
      query({ originStopIndexes: [0, 3] }),
    );
    const repeated = runRaptorOneToAll(
      timetable,
      query({ originStopIndexes: [0, 0, 3, 0, 3] }),
    );

    expect(repeated.arrivalTimes).toEqual(unique.arrivalTimes);
  });

  it('rejects an invalid origin index clearly', () => {
    expect(() =>
      runRaptorOneToAll(
        transferNetwork(),
        query({ originStopIndexes: [5] }),
      ),
    ).toThrow(/origin stop index 5/i);
  });

  it('rejects an empty origin list clearly', () => {
    expect(() =>
      runRaptorOneToAll(
        transferNetwork(),
        query({ originStopIndexes: [] }),
      ),
    ).toThrow(/at least one stop/i);
  });
});

describe('runRaptorOneToAll direct routes', () => {
  it('boards the first route after departure and reaches downstream stops', () => {
    const result = runRaptorOneToAll(transferNetwork(), query());

    expect(arrivalAt(result, 1)).toBe(29_700);
    expect(arrivalAt(result, 2)).toBe(30_300);
  });

  it('boards a departure exactly at query time', () => {
    const timetable = testTimetable(2, [
      testPattern([0, 1], [
        [
          { arrival: DEPARTURE_TIME, departure: DEPARTURE_TIME },
          { arrival: 29_400, departure: 29_400 },
        ],
      ]),
    ]);

    expect(arrivalAt(runRaptorOneToAll(timetable, query()), 1)).toBe(29_400);
  });

  it('cannot board a trip whose origin departure is before query time', () => {
    const timetable = testTimetable(2, [
      testPattern([0, 1], [
        [
          { arrival: 28_799, departure: 28_799 },
          { arrival: 29_000, departure: 29_000 },
        ],
      ]),
    ]);

    expect(arrivalAt(runRaptorOneToAll(timetable, query()), 1)).toBeUndefined();
  });

  it('finds a later eligible trip after earlier departures', () => {
    const timetable = testTimetable(2, [
      testPattern(
        [0, 1],
        [
          [
            { arrival: 28_000, departure: 28_000 },
            { arrival: 28_500, departure: 28_500 },
          ],
          [
            { arrival: 29_000, departure: 29_000 },
            { arrival: 29_600, departure: 29_600 },
          ],
        ],
      ),
    ]);

    expect(arrivalAt(runRaptorOneToAll(timetable, query()), 1)).toBe(29_600);
  });

  it('does not mark a pickup-only pass-through with prohibited drop-off', () => {
    const timetable = testTimetable(3, [
      testPattern([0, 1, 2], [
        [
          { arrival: 28_900, departure: 28_900 },
          { arrival: 29_400, departure: 29_400, dropOffType: 1 },
          { arrival: 30_000, departure: 30_000 },
        ],
      ]),
    ]);
    const result = runRaptorOneToAll(timetable, query());

    expect(arrivalAt(result, 1)).toBeUndefined();
    expect(arrivalAt(result, 2)).toBe(30_000);
  });

  it('cannot board pickup type 1', () => {
    const timetable = testTimetable(2, [
      testPattern([0, 1], [
        [
          { arrival: 28_800, departure: 28_800, pickupType: 1 },
          { arrival: 29_400, departure: 29_400 },
        ],
      ]),
    ]);

    expect(arrivalAt(runRaptorOneToAll(timetable, query()), 1)).toBeUndefined();
  });

  it.each([2, 3] as const)(
    'boards pickup type %i without a special penalty',
    (pickupType) => {
      const timetable = testTimetable(2, [
        testPattern([0, 1], [
          [
            { arrival: 28_800, departure: 28_800, pickupType },
            { arrival: 29_400, departure: 29_400 },
          ],
        ]),
      ]);

      expect(arrivalAt(runRaptorOneToAll(timetable, query()), 1)).toBe(29_400);
    },
  );
});

describe('runRaptorOneToAll transfers', () => {
  it('transfers between two routes sharing the same stop ID', () => {
    const result = runRaptorOneToAll(transferNetwork(), query());

    expect(arrivalAt(result, 3)).toBe(30_900);
    expect(arrivalAt(result, 4)).toBe(31_500);
  });

  it('requires a second RAPTOR round for the second vehicle', () => {
    const timetable = transferNetwork();
    const firstVehicleOnly = runRaptorOneToAll(
      timetable,
      query({ maxTransfers: 0 }),
    );
    const oneTransfer = runRaptorOneToAll(
      timetable,
      query({ maxTransfers: 1 }),
    );

    expect(arrivalAt(firstVehicleOnly, 4)).toBeUndefined();
    expect(arrivalAt(oneTransfer, 4)).toBe(31_500);
  });

  it('allows a departure exactly at the minimum-transfer boundary', () => {
    const routeA = testPattern([0, 1], [
      [
        { arrival: 28_800, departure: 28_800 },
        { arrival: 30_000, departure: 30_000 },
      ],
    ]);
    const routeB = testPattern([1, 2], [
      [
        { arrival: 30_120, departure: 30_120 },
        { arrival: 30_600, departure: 30_600 },
      ],
    ]);
    const result = runRaptorOneToAll(
      testTimetable(3, [routeA, routeB]),
      query({ minTransferTimeSeconds: 120 }),
    );

    expect(arrivalAt(result, 2)).toBe(30_600);
  });

  it('rejects a connection one second before minimum transfer time', () => {
    const routeA = testPattern([0, 1], [
      [
        { arrival: 28_800, departure: 28_800 },
        { arrival: 30_000, departure: 30_000 },
      ],
    ]);
    const routeB = testPattern([1, 2], [
      [
        { arrival: 30_119, departure: 30_119 },
        { arrival: 30_600, departure: 30_600 },
      ],
    ]);
    const result = runRaptorOneToAll(
      testTimetable(3, [routeA, routeB]),
      query({ minTransferTimeSeconds: 120 }),
    );

    expect(arrivalAt(result, 2)).toBeUndefined();
  });

  it('does not apply transfer time to the initial vehicle', () => {
    const timetable = testTimetable(2, [
      testPattern([0, 1], [
        [
          { arrival: 28_900, departure: 28_900 },
          { arrival: 29_400, departure: 29_400 },
        ],
      ]),
    ]);

    expect(
      arrivalAt(
        runRaptorOneToAll(
          timetable,
          query({ minTransferTimeSeconds: 600 }),
        ),
        1,
      ),
    ).toBe(29_400);
  });

  it('platform-to-platform transfer requires future transfer-connectivity milestone', () => {
    const routeA = testPattern([0, 10], [
      [
        { arrival: 28_800, departure: 28_800 },
        { arrival: 29_400, departure: 29_400 },
      ],
    ]);
    const siblingPlatformRoute = testPattern([11, 12], [
      [
        { arrival: 29_600, departure: 29_600 },
        { arrival: 30_000, departure: 30_000 },
      ],
    ]);
    const result = runRaptorOneToAll(
      testTimetable(13, [routeA, siblingPlatformRoute]),
      query(),
    );

    expect(arrivalAt(result, 10)).toBe(29_400);
    expect(arrivalAt(result, 11)).toBeUndefined();
    expect(arrivalAt(result, 12)).toBeUndefined();
  });
});

describe('runRaptorOneToAll one-to-all results', () => {
  it('reaches several stops in one run without a destination list', () => {
    const result = runRaptorOneToAll(transferNetwork(), query());

    expect(Array.from(result.arrivalTimes)).toEqual([
      28_800, 29_700, 30_300, 30_900, 31_500,
    ]);
  });

  it('keeps the earliest arrival when several routes reach one stop', () => {
    const slow = testPattern([0, 1], [
      [
        { arrival: 28_900, departure: 28_900 },
        { arrival: 31_000, departure: 31_000 },
      ],
    ]);
    const fast = testPattern([0, 1], [
      [
        { arrival: 29_000, departure: 29_000 },
        { arrival: 30_000, departure: 30_000 },
      ],
    ]);

    expect(
      arrivalAt(
        runRaptorOneToAll(testTimetable(2, [slow, fast]), query()),
        1,
      ),
    ).toBe(30_000);
  });

  it('allows a later-round faster journey to improve a direct arrival', () => {
    const slowDirect = testPattern([0, 3], [
      [
        { arrival: 28_900, departure: 28_900 },
        { arrival: 33_000, departure: 33_000 },
      ],
    ]);
    const feeder = testPattern([0, 1], [
      [
        { arrival: 28_800, departure: 28_800 },
        { arrival: 29_400, departure: 29_400 },
      ],
    ]);
    const fastConnection = testPattern([1, 3], [
      [
        { arrival: 29_600, departure: 29_600 },
        { arrival: 31_200, departure: 31_200 },
      ],
    ]);
    const result = runRaptorOneToAll(
      testTimetable(4, [slowDirect, feeder, fastConnection]),
      query({ minTransferTimeSeconds: 120 }),
    );

    expect(arrivalAt(result, 3)).toBe(31_200);
  });

  it('leaves unreachable stops at the sentinel and hides it in helpers', () => {
    const result = runRaptorOneToAll(transferNetwork(), query());
    const extended = {
      ...result,
      arrivalTimes: new Uint32Array([...result.arrivalTimes, UNREACHED_TIME]),
    };

    expect(extended.arrivalTimes[5]).toBe(UNREACHED_TIME);
    expect(arrivalAt(extended, 5)).toBeUndefined();
    expect(travelTimeTo(extended, 5)).toBeUndefined();
  });

  it('returns travel time in seconds', () => {
    expect(travelTimeTo(runRaptorOneToAll(transferNetwork(), query()), 1)).toBe(
      900,
    );
  });

  it('produces byte-identical arrival arrays for repeated queries', () => {
    const timetable = transferNetwork();
    const first = runRaptorOneToAll(timetable, query());

    for (let iteration = 0; iteration < 5; iteration += 1) {
      expect(runRaptorOneToAll(timetable, query()).arrivalTimes).toEqual(
        first.arrivalTimes,
      );
    }
  });
});

describe('runRaptorOneToAll maximum travel time', () => {
  it('allows an arrival exactly at the maximum duration', () => {
    const result = runRaptorOneToAll(
      durationTimetable(29_400),
      query({ maxTravelTimeSeconds: 600 }),
    );

    expect(arrivalAt(result, 1)).toBe(29_400);
  });

  it('rejects an arrival one second beyond the maximum duration', () => {
    const result = runRaptorOneToAll(
      durationTimetable(29_401),
      query({ maxTravelTimeSeconds: 600 }),
    );

    expect(arrivalAt(result, 1)).toBeUndefined();
  });

  it('ignores trips departing after the maximum arrival time', () => {
    const result = runRaptorOneToAll(
      durationTimetable(29_500, 29_401),
      query({ maxTravelTimeSeconds: 600 }),
    );

    expect(arrivalAt(result, 1)).toBeUndefined();
  });

  it('does not let a pruned later arrival replace an earlier valid one', () => {
    const valid = testPattern([0, 1], [
      [
        { arrival: 28_800, departure: 28_800 },
        { arrival: 29_300, departure: 29_300 },
      ],
    ]);
    const tooLate = testPattern([0, 1], [
      [
        { arrival: 28_900, departure: 28_900 },
        { arrival: 29_500, departure: 29_500 },
      ],
    ]);
    const result = runRaptorOneToAll(
      testTimetable(2, [valid, tooLate]),
      query({ maxTravelTimeSeconds: 600 }),
    );

    expect(arrivalAt(result, 1)).toBe(29_300);
  });

  it('supports very small positive commute limits', () => {
    const result = runRaptorOneToAll(
      durationTimetable(28_801),
      query({ maxTravelTimeSeconds: 1 }),
    );

    expect(arrivalAt(result, 1)).toBe(28_801);
  });
});

describe('runRaptorOneToAll validation and diagnostics', () => {
  it('rejects invalid time and transfer configuration', () => {
    const timetable = transferNetwork();

    expect(() =>
      runRaptorOneToAll(timetable, query({ maxTravelTimeSeconds: 0 })),
    ).toThrow(/positive integer/i);
    expect(() =>
      runRaptorOneToAll(timetable, query({ maxTransfers: -1 })),
    ).toThrow(/maxTransfers/i);
    expect(() =>
      runRaptorOneToAll(
        timetable,
        query({ minTransferTimeSeconds: -1 }),
      ),
    ).toThrow(/minTransferTimeSeconds/i);
    expect(() =>
      runRaptorOneToAll(timetable, query({ departureTimeSeconds: -1 })),
    ).toThrow(/departureTimeSeconds/i);
    expect(() =>
      runRaptorOneToAll(
        timetable,
        query({
          departureTimeSeconds: UNREACHED_TIME - 1,
          maxTravelTimeSeconds: 1,
        }),
      ),
    ).toThrow(/supported time range/i);
  });

  it('reports rounds, pattern scans, and arrival improvements', () => {
    let diagnostics: RaptorRoutingDiagnostics | undefined;

    runRaptorOneToAll(transferNetwork(), query(), (value) => {
      diagnostics = value;
    });

    expect(diagnostics?.roundsExecuted).toBeGreaterThanOrEqual(2);
    expect(diagnostics?.patternsScanned).toBe(
      diagnostics?.patternScansPerRound.reduce(
        (total, scans) => total + scans,
        0,
      ),
    );
    expect(diagnostics?.stopsImproved).toBeGreaterThanOrEqual(4);
  });
});
