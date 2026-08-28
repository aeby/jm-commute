import { describe, expect, expectTypeOf, it } from 'vitest';

import type { ReachableLocality } from '../../../localities';
import type { LocalityRoutingStopIndex } from '../../locality-routing/types';
import { resolveFastestReachableLocalities } from '../../locality-routing/resolve-fastest-reachable-localities';
import { testPattern, testTimetable } from '../../raptor/routing/__tests__/test-timetable';
import { runRaptorFastestWindow } from '../../raptor/routing/run-raptor-fastest-window';
import { createRaptorReachabilityQuery } from '../raptor-reachability-query';

const WINDOW_START = 28_800;
const WINDOW_END = 28_801;

function fixture() {
  const timetable = testTimetable(2, [
    testPattern([0, 1], [
      [
        { arrival: WINDOW_START, departure: WINDOW_START },
        { arrival: WINDOW_START + 1_801, departure: WINDOW_START + 1_801 },
      ],
    ]),
  ]);
  const localityRoutingIndex: LocalityRoutingStopIndex = {
    entries: [
      {
        localityId: '8001:zurich',
        stopIndexes: Uint32Array.of(0),
      },
      {
        localityId: '3011:bern',
        stopIndexes: Uint32Array.of(1),
      },
      {
        localityId: '0000:none',
        stopIndexes: new Uint32Array(),
      },
    ],
  };
  const query = createRaptorReachabilityQuery({
    timetable,
    localityRoutingIndex,
    windowStartSeconds: WINDOW_START,
    windowEndSeconds: WINDOW_END,
    maxTransfers: 0,
    minTransferTimeSeconds: 0,
  });
  return { timetable, localityRoutingIndex, query };
}

describe('createRaptorReachabilityQuery', () => {
  it('preserves the existing synthetic fastest-window locality result', () => {
    const { timetable, localityRoutingIndex, query } = fixture();
    const directResult = resolveFastestReachableLocalities(
      runRaptorFastestWindow(timetable, {
        originStopIndexes: [0],
        windowStartSeconds: WINDOW_START,
        windowEndSeconds: WINDOW_END,
        maxTravelTimeSeconds: 31 * 60,
        maxTransfers: 0,
        minTransferTimeSeconds: 0,
      }),
      localityRoutingIndex,
    );

    expect(
      query('8001:zurich', 31),
    ).toEqual(directResult);
    expectTypeOf(directResult).toEqualTypeOf<readonly ReachableLocality[]>();
  });

  it('applies an inclusive whole-minute threshold and preserves direction', () => {
    const { query } = fixture();

    expect(
      query('8001:zurich', 30),
    ).toEqual([{ localityId: '8001:zurich', travelMinutes: 0 }]);
    expect(
      query('8001:zurich', 31),
    ).toEqual([
      { localityId: '8001:zurich', travelMinutes: 0 },
      { localityId: '3011:bern', travelMinutes: 31 },
    ]);
    expect(
      query('3011:bern', 31),
    ).toEqual([{ localityId: '3011:bern', travelMinutes: 0 }]);
  });

  it('rejects unknown localities and invalid commute limits', () => {
    const { query } = fixture();

    expect(() =>
      query('9999:missing', 30),
    ).toThrow('Unknown transit-routing locality');
    expect(() =>
      query('8001:zurich', -1),
    ).toThrow('nonnegative safe integer');
    expect(() =>
      query('8001:zurich', 30.5),
    ).toThrow('nonnegative safe integer');
  });

  it('returns no destinations for a known locality without active stops', () => {
    expect(fixture().query('0000:none', 240)).toEqual([]);
  });
});
