import { describe, expect, it } from 'vitest';

import type { PublicTransportNetwork } from '../../../network/timetable/types';
import { runRaptorFastestWindow } from '../run-raptor-fastest-window';
import { UNREACHED_TIME } from '../state';
import type { FastestWindowQuery, FastestWindowResult } from '../types';
import {
  collectOriginDepartureSlots,
  runRaptorOneToAll,
  testPattern,
  testTimetable,
} from './test-timetable';

const HOUR = 60 * 60;
const WINDOW_START = 7 * HOUR;
const WINDOW_END = 9 * HOUR;

const query = (
  originStopIndexes: readonly number[] = [0],
): FastestWindowQuery => ({
  originStopIndexes,
  windowStartSeconds: WINDOW_START,
  windowEndSeconds: WINDOW_END,
  maxTravelTimeSeconds: 3 * HOUR,
  maxTransfers: 2,
  minTransferTimeSeconds: 120,
});

const replaceTransferAdjacency = (
  timetable: PublicTransportNetwork,
  values: {
    readonly transfersByStop?: readonly Uint32Array[];
    readonly accessTransfersByStop?: readonly Uint32Array[];
  },
): PublicTransportNetwork => ({ ...timetable, ...values });

const bruteForceFastestWindow = (
  timetable: PublicTransportNetwork,
  fastestQuery: FastestWindowQuery,
): FastestWindowResult => {
  const slots = collectOriginDepartureSlots(
    timetable,
    fastestQuery.originStopIndexes,
    fastestQuery.windowStartSeconds,
    fastestQuery.windowEndSeconds,
    fastestQuery.minTransferTimeSeconds,
  );
  const durationSeconds = new Uint32Array(
    timetable.sourceStopIds.length,
  ).fill(UNREACHED_TIME);
  const departureTimes = new Uint32Array(
    timetable.sourceStopIds.length,
  ).fill(UNREACHED_TIME);
  const arrivalTimes = new Uint32Array(
    timetable.sourceStopIds.length,
  ).fill(UNREACHED_TIME);

  for (const departureTimeSeconds of slots) {
    const result = runRaptorOneToAll(timetable, {
      originStopIndexes: fastestQuery.originStopIndexes,
      departureTimeSeconds,
      maxTravelTimeSeconds: fastestQuery.maxTravelTimeSeconds,
      maxTransfers: fastestQuery.maxTransfers,
      minTransferTimeSeconds: fastestQuery.minTransferTimeSeconds,
    });
    for (let stopIndex = 0; stopIndex < result.arrivalTimes.length; stopIndex += 1) {
      const arrival = result.arrivalTimes[stopIndex] ?? UNREACHED_TIME;
      if (arrival === UNREACHED_TIME) {
        continue;
      }
      const duration = arrival - departureTimeSeconds;
      const bestDuration = durationSeconds[stopIndex] ?? UNREACHED_TIME;
      const bestDeparture = departureTimes[stopIndex] ?? 0;
      const bestArrival = arrivalTimes[stopIndex] ?? UNREACHED_TIME;
      if (
        duration < bestDuration ||
        (duration === bestDuration &&
          (departureTimeSeconds > bestDeparture ||
            (departureTimeSeconds === bestDeparture && arrival < bestArrival)))
      ) {
        durationSeconds[stopIndex] = duration;
        departureTimes[stopIndex] = departureTimeSeconds;
        arrivalTimes[stopIndex] = arrival;
      }
    }
  }

  return { durationSeconds, departureTimes, arrivalTimes };
};

describe('runRaptorFastestWindow', () => {
  it('normalizes duplicate origins once without changing the result', () => {
    const timetable = testTimetable(3, [
      testPattern([0, 2], [
        [
          { arrival: 8 * HOUR, departure: 8 * HOUR },
          { arrival: 8 * HOUR + 600, departure: 8 * HOUR + 600 },
        ],
      ]),
      testPattern([1, 2], [
        [
          { arrival: 8 * HOUR + 60, departure: 8 * HOUR + 60 },
          { arrival: 8 * HOUR + 540, departure: 8 * HOUR + 540 },
        ],
      ]),
    ]);

    const unique = runRaptorFastestWindow(timetable, query([0, 1]));
    const duplicate = runRaptorFastestWindow(
      timetable,
      query([0, 1, 0, 1]),
    );

    expect(duplicate.durationSeconds).toEqual(unique.durationSeconds);
    expect(duplicate.departureTimes).toEqual(unique.departureTimes);
    expect(duplicate.arrivalTimes).toEqual(unique.arrivalTimes);
  });

  it('rejects an invalid origin before processing departure slots', () => {
    expect(() =>
      runRaptorFastestWindow(testTimetable(1, []), query([1])),
    ).toThrow(/invalid origin stop index/i);
  });

  it('optimizes duration rather than earliest absolute arrival', () => {
    const timetable = testTimetable(2, [
      testPattern(
        [0, 1],
        [
          [
            { arrival: 7 * HOUR, departure: 7 * HOUR },
            { arrival: 8 * HOUR, departure: 8 * HOUR },
          ],
          [
            { arrival: 8 * HOUR, departure: 8 * HOUR },
            { arrival: 8 * HOUR + 45 * 60, departure: 8 * HOUR + 45 * 60 },
          ],
        ],
      ),
    ]);

    const result = runRaptorFastestWindow(timetable, query());

    expect(result.durationSeconds[1]).toBe(45 * 60);
    expect(result.departureTimes[1]).toBe(8 * HOUR);
    expect(result.arrivalTimes[1]).toBe(8 * HOUR + 45 * 60);
  });

  it('counts waiting after the selected origin departure', () => {
    const timetable = testTimetable(2, [
      testPattern([0, 1], [
        [
          { arrival: 8 * HOUR, departure: 8 * HOUR },
          { arrival: 8 * HOUR + 30 * 60, departure: 8 * HOUR + 30 * 60 },
        ],
      ]),
    ]);
    const result = runRaptorFastestWindow(timetable, {
      ...query(),
      windowStartSeconds: 7 * HOUR + 55 * 60,
      windowEndSeconds: 8 * HOUR,
    });

    expect(result.durationSeconds[1]).toBe(35 * 60);
    expect(result.departureTimes[1]).toBe(7 * HOUR + 55 * 60);
  });

  it('counts a Bern-style six-minute initial access transfer', () => {
    const trainDeparture = 8 * HOUR + 2 * 60;
    const base = testTimetable(3, [
      testPattern([1, 2], [
        [
          { arrival: trainDeparture, departure: trainDeparture },
          { arrival: 8 * HOUR + 58 * 60, departure: 8 * HOUR + 58 * 60 },
        ],
      ]),
    ]);
    const timetable = replaceTransferAdjacency(base, {
      accessTransfersByStop: [
        new Uint32Array([1, 6 * 60]),
        new Uint32Array(),
        new Uint32Array(),
      ],
    });

    const result = runRaptorFastestWindow(timetable, query());

    expect(result.durationSeconds[2]).toBe(62 * 60);
    expect(result.departureTimes[2]).toBe(7 * HOUR + 56 * 60);
    expect(result.arrivalTimes[2]).toBe(8 * HOUR + 58 * 60);
  });

  it('prefers the later departure when durations are equal', () => {
    const timetable = testTimetable(2, [
      testPattern(
        [0, 1],
        [
          [
            { arrival: 7 * HOUR + 30 * 60, departure: 7 * HOUR + 30 * 60 },
            { arrival: 8 * HOUR, departure: 8 * HOUR },
          ],
          [
            { arrival: 8 * HOUR + 15 * 60, departure: 8 * HOUR + 15 * 60 },
            { arrival: 8 * HOUR + 45 * 60, departure: 8 * HOUR + 45 * 60 },
          ],
        ],
      ),
    ]);

    const result = runRaptorFastestWindow(timetable, query());

    expect(result.durationSeconds[1]).toBe(30 * 60);
    expect(result.departureTimes[1]).toBe(8 * HOUR + 15 * 60);
  });

  it('enforces the inclusive start and exclusive end of the window', () => {
    const timetable = testTimetable(2, [
      testPattern(
        [0, 1],
        [
          [
            { arrival: WINDOW_START - 1, departure: WINDOW_START - 1 },
            { arrival: WINDOW_START + 60, departure: WINDOW_START + 60 },
          ],
          [
            { arrival: WINDOW_START, departure: WINDOW_START },
            { arrival: WINDOW_START + 120, departure: WINDOW_START + 120 },
          ],
          [
            { arrival: WINDOW_END - 1, departure: WINDOW_END - 1 },
            { arrival: WINDOW_END + 59, departure: WINDOW_END + 59 },
          ],
          [
            { arrival: WINDOW_END, departure: WINDOW_END },
            { arrival: WINDOW_END + 60, departure: WINDOW_END + 60 },
          ],
        ],
      ),
    ]);

    const result = runRaptorFastestWindow(timetable, query());

    expect(result.durationSeconds[1]).toBe(60);
    expect(result.departureTimes[1]).toBe(WINDOW_END - 1);
  });

  it('matches independent brute-force runs across direct, transfer, and access networks', () => {
    const direct = testTimetable(3, [
      testPattern(
        [0, 1, 2],
        [
          [
            { arrival: WINDOW_START, departure: WINDOW_START },
            { arrival: WINDOW_START + 600, departure: WINDOW_START + 600 },
            { arrival: WINDOW_START + 1_200, departure: WINDOW_START + 1_200 },
          ],
          [
            { arrival: 8 * HOUR, departure: 8 * HOUR },
            { arrival: 8 * HOUR + 420, departure: 8 * HOUR + 420 },
            { arrival: 8 * HOUR + 900, departure: 8 * HOUR + 900 },
          ],
        ],
      ),
    ]);

    const transferBase = testTimetable(4, [
      testPattern([0, 1], [
        [
          { arrival: WINDOW_START + 300, departure: WINDOW_START + 300 },
          { arrival: WINDOW_START + 900, departure: WINDOW_START + 900 },
        ],
      ]),
      testPattern([2, 3], [
        [
          { arrival: WINDOW_START + 1_080, departure: WINDOW_START + 1_080 },
          { arrival: WINDOW_START + 1_800, departure: WINDOW_START + 1_800 },
        ],
      ]),
    ]);
    const transfer = replaceTransferAdjacency(transferBase, {
      transfersByStop: [
        new Uint32Array(),
        new Uint32Array([2, 180]),
        new Uint32Array(),
        new Uint32Array(),
      ],
    });

    const accessBase = testTimetable(3, [
      testPattern([1, 2], [
        [
          { arrival: 8 * HOUR + 120, departure: 8 * HOUR + 120 },
          { arrival: 8 * HOUR + 1_800, departure: 8 * HOUR + 1_800 },
        ],
      ]),
    ]);
    const access = replaceTransferAdjacency(accessBase, {
      accessTransfersByStop: [
        new Uint32Array([1, 360]),
        new Uint32Array(),
        new Uint32Array(),
      ],
    });

    // A transferred arrival is ready to board immediately, while a vehicle
    // arrival at the same stop still needs the same-stop transfer allowance.
    // Cross-run pruning must not conflate those two round states.
    const modeSensitiveBase = testTimetable(4, [
      testPattern([0, 1], [
        [
          { arrival: 8 * HOUR, departure: 8 * HOUR },
          { arrival: 8 * HOUR + 600, departure: 8 * HOUR + 600 },
        ],
      ]),
      testPattern([0, 2], [
        [
          { arrival: 7 * HOUR + 50 * 60, departure: 7 * HOUR + 50 * 60 },
          { arrival: 8 * HOUR, departure: 8 * HOUR },
        ],
      ]),
      testPattern([1, 3], [
        [
          { arrival: 8 * HOUR + 11 * 60, departure: 8 * HOUR + 11 * 60 },
          { arrival: 8 * HOUR + 20 * 60, departure: 8 * HOUR + 20 * 60 },
        ],
      ]),
    ]);
    const modeSensitive = replaceTransferAdjacency(modeSensitiveBase, {
      transfersByStop: [
        new Uint32Array(),
        new Uint32Array(),
        new Uint32Array([1, 11 * 60]),
        new Uint32Array(),
      ],
    });

    for (const timetable of [direct, transfer, access, modeSensitive]) {
      const expected = bruteForceFastestWindow(timetable, query());
      const actual = runRaptorFastestWindow(timetable, query());

      expect(actual.durationSeconds).toEqual(expected.durationSeconds);
      expect(actual.departureTimes).toEqual(expected.departureTimes);
      expect(actual.arrivalTimes).toEqual(expected.arrivalTimes);
    }
  });

  it('matches the brute-force oracle on deterministically generated networks', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const firstDeparture = WINDOW_START + seed * 37;
      const departures = [0, 900, 1_800].map(
        (offset) => firstDeparture + offset,
      );
      const firstPattern = testPattern(
        [0, 1, 2],
        departures.map((departure, tripIndex) => [
          { arrival: departure, departure },
          {
            arrival: departure + 240 + seed + tripIndex * 3,
            departure: departure + 270 + seed + tripIndex * 3,
          },
          {
            arrival: departure + 600 + seed * 2 + tripIndex * 5,
            departure: departure + 600 + seed * 2 + tripIndex * 5,
          },
        ]),
      );
      const secondPattern = testPattern(
        [2, 3, 4],
        departures.map((departure, tripIndex) => {
          const connectionDeparture =
            departure + 720 + seed * 2 + tripIndex * 5;
          return [
            {
              arrival: connectionDeparture,
              departure: connectionDeparture,
            },
            {
              arrival: connectionDeparture + 300 + seed,
              departure: connectionDeparture + 315 + seed,
            },
            {
              arrival: connectionDeparture + 720 + seed,
              departure: connectionDeparture + 720 + seed,
            },
          ];
        }),
      );
      const base = testTimetable(5, [firstPattern, secondPattern]);
      const timetable = replaceTransferAdjacency(base, {
        transfersByStop: [
          new Uint32Array(),
          new Uint32Array([3, 180 + seed]),
          new Uint32Array(),
          new Uint32Array(),
          new Uint32Array(),
        ],
      });
      const expected = bruteForceFastestWindow(timetable, query());
      const actual = runRaptorFastestWindow(timetable, query());

      expect(actual.durationSeconds).toEqual(expected.durationSeconds);
      expect(actual.departureTimes).toEqual(expected.departureTimes);
      expect(actual.arrivalTimes).toEqual(expected.arrivalTimes);
    }
  });
});
