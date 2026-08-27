import { describe, expect, it } from 'vitest';

import { UNREACHED_TIME, type RaptorResult } from '../../../transit/raptor';
import type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
} from '../types';
import {
  createReachableLocalityMap,
  resolveReachableLocalities,
} from '../resolve-reachable-localities';

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

function resolve(
  arrivalTimes: readonly number[],
  entries: readonly LocalityRoutingEntry[],
) {
  const result: RaptorResult = {
    departureTimeSeconds: DEPARTURE,
    arrivalTimes: Uint32Array.from(arrivalTimes),
  };
  const index: LocalityRoutingIndex = { entries };
  return resolveReachableLocalities(result, index);
}

describe('resolveReachableLocalities', () => {
  it('makes a locality reachable through one stop', () => {
    expect(resolve([DEPARTURE + 600], [entry('8001:zurich', [0])])).toEqual([
      { localityId: '8001:zurich', travelMinutes: 10 },
    ]);
  });

  it('uses the earliest of several destination stops', () => {
    expect(
      resolve(
        [DEPARTURE + 1_800, DEPARTURE + 1_200, UNREACHED_TIME],
        [entry('3011:bern', [0, 1, 2])],
      ),
    ).toEqual([{ localityId: '3011:bern', travelMinutes: 20 }]);
  });

  it('omits localities whose stops are all unreachable or empty', () => {
    expect(
      resolve(
        [UNREACHED_TIME],
        [entry('1000:unreachable', [0]), entry('1001:empty', [])],
      ),
    ).toEqual([]);
  });

  it('supports a zero-minute origin locality', () => {
    expect(resolve([DEPARTURE], [entry('8001:zurich', [0])])).toEqual([
      { localityId: '8001:zurich', travelMinutes: 0 },
    ]);
  });

  it('keeps exact minutes and rounds partial minutes upward', () => {
    expect(
      resolve(
        [DEPARTURE + 1_800, DEPARTURE + 1_801],
        [entry('3000:exact', [0]), entry('3001:partial', [1])],
      ),
    ).toEqual([
      { localityId: '3000:exact', travelMinutes: 30 },
      { localityId: '3001:partial', travelMinutes: 31 },
    ]);
  });

  it('allows several localities to share one routing stop', () => {
    expect(
      resolve(
        [DEPARTURE + 300],
        [entry('8002:a', [0]), entry('8003:b', [0])],
      ),
    ).toHaveLength(2);
  });

  it('sorts by travel minutes and then lexical locality ID', () => {
    expect(
      resolve(
        [DEPARTURE + 600, DEPARTURE + 300, DEPARTURE + 300],
        [
          entry('9000:later', [0]),
          entry('8002:b', [1]),
          entry('8001:a', [2]),
        ],
      ),
    ).toEqual([
      { localityId: '8001:a', travelMinutes: 5 },
      { localityId: '8002:b', travelMinutes: 5 },
      { localityId: '9000:later', travelMinutes: 10 },
    ]);
  });

  it('creates a locality-to-travel-minutes lookup map', () => {
    const reachable = [
      { localityId: '8001:zurich', travelMinutes: 0 },
      { localityId: '3011:bern', travelMinutes: 58 },
    ];

    expect([...createReachableLocalityMap(reachable)]).toEqual([
      ['8001:zurich', 0],
      ['3011:bern', 58],
    ]);
  });

  it('fails clearly when index and RAPTOR result stop spaces differ', () => {
    expect(() => resolve([DEPARTURE], [entry('8001:zurich', [1])])).toThrow(
      /references stop index/i,
    );
  });
});
