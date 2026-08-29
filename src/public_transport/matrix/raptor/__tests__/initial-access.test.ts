import { describe, expect, it } from 'vitest';

import { USE_QUERY_TRANSFER_TIME } from '../../../network/transfer-encoding';
import type { PublicTransportNetwork } from '../../../network/timetable/types';
import { collectInitialAccessStops } from '../collect-initial-access-stops';
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
  maxTravelTimeSeconds: 3_600,
  maxTransfers: 0,
  minTransferTimeSeconds: 120,
  ...overrides,
});

const withAccessTransfers = (
  timetable: PublicTransportNetwork,
  edges: readonly (readonly [from: number, to: number, duration: number])[],
): PublicTransportNetwork => {
  const adjacency = Array.from(
    { length: timetable.sourceStopIds.length },
    () => [] as number[],
  );
  for (const [from, to, duration] of edges) {
    adjacency[from]?.push(to, duration);
  }
  return {
    ...timetable,
    accessTransfersByStop: adjacency.map(
      (values) => new Uint32Array(values),
    ),
  };
};

const accessToTrainNetwork = (
  accessDuration: number,
  trainDeparture: number,
): PublicTransportNetwork => {
  const train = testPattern([1, 2], [
    [
      { arrival: trainDeparture, departure: trainDeparture },
      { arrival: 30_600, departure: 30_600 },
    ],
  ]);
  return withAccessTransfers(testTimetable(3, [train]), [
    [0, 1, accessDuration],
  ]);
};

describe('initial access collection', () => {
  it('seeds originals and follows exactly one access edge', () => {
    const result = collectInitialAccessStops(
      [
        new Uint32Array([1, 120]),
        new Uint32Array([2, 120]),
        new Uint32Array(),
      ],
      [0],
      DEPARTURE_TIME,
      90,
      DEPARTURE_TIME + 3_600,
    );

    expect(result).toEqual([
      { stopIndex: 0, arrivalTimeSeconds: DEPARTURE_TIME },
      { stopIndex: 1, arrivalTimeSeconds: DEPARTURE_TIME + 120 },
    ]);
  });

  it('keeps the earliest access arrival from several origins', () => {
    const result = collectInitialAccessStops(
      [
        new Uint32Array([2, 300]),
        new Uint32Array([2, 180]),
        new Uint32Array(),
      ],
      [0, 1],
      DEPARTURE_TIME,
      120,
      DEPARTURE_TIME + 3_600,
    );

    expect(result).toContainEqual({
      stopIndex: 2,
      arrivalTimeSeconds: DEPARTURE_TIME + 180,
    });
  });

  it('uses the query fallback and prunes beyond the commute limit', () => {
    const result = collectInitialAccessStops(
      [new Uint32Array([1, USE_QUERY_TRANSFER_TIME, 2, 301]), new Uint32Array(), new Uint32Array()],
      [0],
      DEPARTURE_TIME,
      120,
      DEPARTURE_TIME + 300,
    );

    expect(result).toContainEqual({
      stopIndex: 1,
      arrivalTimeSeconds: DEPARTURE_TIME + 120,
    });
    expect(result.some(({ stopIndex }) => stopIndex === 2)).toBe(false);
  });
});

describe('RAPTOR initial access routing', () => {
  it('reaches a rail platform and boards the first vehicle', () => {
    const result = runRaptorOneToAll(
      accessToTrainNetwork(180, 29_040),
      query(),
    );

    expect(arrivalAt(result, 1)).toBe(28_980);
    expect(arrivalAt(result, 2)).toBe(30_600);
  });

  it('allows the exact access boundary and rejects a departure one second too early', () => {
    expect(
      arrivalAt(
        runRaptorOneToAll(
          accessToTrainNetwork(240, 29_040),
          query(),
        ),
        2,
      ),
    ).toBe(30_600);
    expect(
      arrivalAt(
        runRaptorOneToAll(
          accessToTrainNetwork(241, 29_040),
          query(),
        ),
        2,
      ),
    ).toBeUndefined();
  });

  it('does not add the global transfer penalty after explicit access', () => {
    const result = runRaptorOneToAll(
      accessToTrainNetwork(180, 28_980),
      query({ minTransferTimeSeconds: 120 }),
    );

    expect(arrivalAt(result, 2)).toBe(30_600);
  });

  it('uses the query fallback for a sibling access edge', () => {
    const result = runRaptorOneToAll(
      accessToTrainNetwork(USE_QUERY_TRANSFER_TIME, 28_920),
      query({ minTransferTimeSeconds: 120 }),
    );

    expect(arrivalAt(result, 1)).toBe(28_920);
    expect(arrivalAt(result, 2)).toBe(30_600);
  });

  it('does not chain access edges', () => {
    const timetable = withAccessTransfers(testTimetable(3, []), [
      [0, 1, 120],
      [1, 2, 120],
    ]);
    const result = runRaptorOneToAll(timetable, query());

    expect(arrivalAt(result, 1)).toBe(28_920);
    expect(arrivalAt(result, 2)).toBeUndefined();
  });

  it('allows access plus one vehicle when maxTransfers is zero', () => {
    expect(
      arrivalAt(
        runRaptorOneToAll(
          accessToTrainNetwork(180, 29_040),
          query({ maxTransfers: 0 }),
        ),
        2,
      ),
    ).toBe(30_600);
  });

  it('does not delay direct service from an original origin', () => {
    const direct = testPattern([0, 1], [
      [
        { arrival: DEPARTURE_TIME, departure: DEPARTURE_TIME },
        { arrival: 29_400, departure: 29_400 },
      ],
    ]);
    const timetable = withAccessTransfers(testTimetable(3, [direct]), [
      [0, 2, 300],
    ]);

    expect(arrivalAt(runRaptorOneToAll(timetable, query()), 1)).toBe(29_400);
  });
});
