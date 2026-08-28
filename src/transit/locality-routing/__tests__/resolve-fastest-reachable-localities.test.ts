import { describe, expect, it } from 'vitest';

import {
  UNREACHED_TIME,
  type FastestWindowResult,
} from '../../raptor';
import type { LocalityRoutingEntry } from '../types';
import {
  resolveFastestReachableLocalities,
  resolveFastestReachableLocalitiesDebug,
} from '../resolve-fastest-reachable-localities';

const DEPARTURE = 28_800;

function entry(
  localityId: string,
  stopIndexes: readonly number[],
): LocalityRoutingEntry {
  const separator = localityId.indexOf(':');
  return {
    localityId,
    postalCode: localityId.slice(0, separator),
    city: localityId.slice(separator + 1),
    selectionMode: 'WITHIN_ACCESS_RADIUS',
    stopIndexes: Uint32Array.from(stopIndexes),
  };
}

function resolveFastest(
  durations: readonly number[],
  entries: readonly LocalityRoutingEntry[],
  departures: readonly number[] = durations.map(() => DEPARTURE),
): ReturnType<typeof resolveFastestReachableLocalities> {
  const result: FastestWindowResult = {
    durationSeconds: Uint32Array.from(durations),
    departureTimes: Uint32Array.from(departures),
    arrivalTimes: Uint32Array.from(
      durations.map((duration, index) =>
        duration === UNREACHED_TIME
          ? UNREACHED_TIME
          : (departures[index] ?? DEPARTURE) + duration,
      ),
    ),
  };
  return resolveFastestReachableLocalities(result, { entries });
}

describe('resolveFastestReachableLocalities', () => {
  it('uses the shortest duration across all destination stops', () => {
    expect(
      resolveFastest(
        [1_800, 1_201, UNREACHED_TIME],
        [entry('3011:bern', [0, 1, 2])],
      ),
    ).toEqual([{ localityId: '3011:bern', travelMinutes: 21 }]);
  });

  it('omits all-unreachable and empty localities', () => {
    expect(
      resolveFastest(
        [UNREACHED_TIME],
        [entry('1000:none', [0]), entry('1001:empty', [])],
        [UNREACHED_TIME],
      ),
    ).toEqual([]);
  });

  it('supports zero duration and rounds partial minutes upward', () => {
    expect(
      resolveFastest(
        [0, 1_800, 1_801],
        [
          entry('1000:origin', [0]),
          entry('1001:exact', [1]),
          entry('1002:partial', [2]),
        ],
      ),
    ).toEqual([
      { localityId: '1000:origin', travelMinutes: 0 },
      { localityId: '1001:exact', travelMinutes: 30 },
      { localityId: '1002:partial', travelMinutes: 31 },
    ]);
  });

  it('sorts deterministically and permits several localities to share a stop', () => {
    expect(
      resolveFastest(
        [300, 600],
        [
          entry('8002:b', [0]),
          entry('8001:a', [0]),
          entry('9000:later', [1]),
        ],
      ),
    ).toEqual([
      { localityId: '8001:a', travelMinutes: 5 },
      { localityId: '8002:b', travelMinutes: 5 },
      { localityId: '9000:later', travelMinutes: 10 },
    ]);
  });

  it('fails clearly when index and result stop spaces differ', () => {
    expect(() =>
      resolveFastest([0], [entry('8001:zurich', [1])]),
    ).toThrow(/references stop index/i);
  });

  it('preserves best departure and arrival in the diagnostic result only', () => {
    const result: FastestWindowResult = {
      durationSeconds: new Uint32Array([1_800, 1_800]),
      departureTimes: new Uint32Array([27_000, 28_800]),
      arrivalTimes: new Uint32Array([28_800, 30_600]),
    };

    expect(
      resolveFastestReachableLocalitiesDebug(result, {
        entries: [entry('8001:zurich', [0, 1])],
      }),
    ).toEqual([
      {
        localityId: '8001:zurich',
        travelMinutes: 30,
        departureTimeSeconds: 28_800,
        arrivalTimeSeconds: 30_600,
      },
    ]);
  });
});
