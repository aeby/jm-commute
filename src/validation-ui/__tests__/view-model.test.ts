import { describe, expect, it } from 'vitest';

import {
  UNREACHED_TIME,
  type FastestWindowResult,
} from '../../transit/raptor';
import type {
  LocalityRoutingIndex,
  ReachableLocalityDebug,
} from '../../transit/locality-routing';
import type { ValidationHubCandidate } from '../validation-data';
import {
  createReachabilityBuckets,
  ValidationViewModel,
  type ValidationRoutingEngine,
} from '../view-model';

const INDEX: LocalityRoutingIndex = {
  entries: [
    {
      localityId: '8001:zurich',
      postalCode: '8001',
      city: 'Zürich',
      selectionMode: 'WITHIN_ACCESS_RADIUS',
      stopIndexes: new Uint32Array([1, 2]),
    },
    {
      localityId: '3011:bern',
      postalCode: '3011',
      city: 'Bern',
      selectionMode: 'NEAREST_FALLBACK',
      stopIndexes: new Uint32Array([3]),
    },
  ],
};

const HUB: ValidationHubCandidate = {
  placeId: 'hub',
  name: 'Zürich HB',
  distanceMeters: 674,
  routeCount: 47,
  departureCount: 224,
  railRouteCount: 20,
  railDepartureCount: 80,
};

function setup(reachable: readonly ReachableLocalityDebug[] = []) {
  const calls: { readonly origins: readonly number[]; readonly minutes: number }[] = [];
  const result: FastestWindowResult = {
    durationSeconds: new Uint32Array([
      UNREACHED_TIME,
      0,
      600,
      3_840,
    ]),
    departureTimes: new Uint32Array([
      UNREACHED_TIME,
      25_200,
      28_800,
      28_800,
    ]),
    arrivalTimes: new Uint32Array([UNREACHED_TIME, 28_800, 29_400, 32_640]),
  };
  const engine: ValidationRoutingEngine = {
    run: (origins, minutes) => {
      calls.push({ origins: [...origins], minutes });
      return result;
    },
    resolve: () => reachable,
  };
  return {
    calls,
    model: new ValidationViewModel(
      INDEX,
      { '8001:zurich': [HUB], '3011:bern': [] },
      engine,
    ),
  };
}

describe('ValidationViewModel', () => {
  it('selects the correct origin entry and hub candidates', () => {
    const { model } = setup();
    const selection = model.selectOrigin('8001:zurich');
    expect(selection.entry.stopIndexes).toEqual(new Uint32Array([1, 2]));
    expect(selection.hubs).toEqual([HUB]);
    expect(selection.isFallback).toBe(false);
  });

  it('exposes fallback mode', () => {
    expect(setup().model.selectOrigin('3011:bern').isFallback).toBe(true);
  });

  it('passes the selected travel limit and origins to routing', () => {
    const { model, calls } = setup();
    model.selectOrigin('8001:zurich');
    model.calculate(60);
    expect(calls).toEqual([{ origins: [1, 2], minutes: 60 }]);
  });

  it('returns reachable localities and bucket counts', () => {
    const reachable = [
      {
        localityId: '8001:zurich',
        travelMinutes: 0,
        departureTimeSeconds: 25_200,
        arrivalTimeSeconds: 25_200,
      },
      {
        localityId: '8002:zurich',
        travelMinutes: 14,
        departureTimeSeconds: 28_800,
        arrivalTimeSeconds: 29_640,
      },
      {
        localityId: '3011:bern',
        travelMinutes: 60,
        departureTimeSeconds: 27_000,
        arrivalTimeSeconds: 30_600,
      },
    ];
    const { model } = setup(reachable);
    model.selectOrigin('8001:zurich');
    const calculation = model.calculate(60);
    expect(calculation.reachableLocalities).toHaveLength(3);
    expect(calculation.buckets).toEqual([
      { minutes: 15, localityCount: 2 },
      { minutes: 30, localityCount: 2 },
      { minutes: 45, localityCount: 2 },
      { minutes: 60, localityCount: 3 },
    ]);
  });

  it('finds reachable and unreachable-within-limit destinations', () => {
    const { model } = setup([
      {
        localityId: '3011:bern',
        travelMinutes: 64,
        departureTimeSeconds: 28_560,
        arrivalTimeSeconds: 32_400,
      },
    ]);
    model.selectOrigin('8001:zurich');
    model.selectDestination('3011:bern');
    model.calculate(90);
    expect(model.getDestinationStatus()).toEqual({
      kind: 'REACHABLE',
      localityId: '3011:bern',
      travelMinutes: 64,
      departureTimeSeconds: 28_560,
      arrivalTimeSeconds: 32_400,
    });

    model.selectDestination('8001:zurich');
    expect(model.getDestinationStatus()).toEqual({
      kind: 'NOT_REACHABLE_WITHIN_LIMIT',
      localityId: '8001:zurich',
      maxTravelTimeMinutes: 90,
    });
  });

  it('does not rerun routing when the destination changes', () => {
    const { model, calls } = setup();
    model.selectOrigin('8001:zurich');
    model.calculate(60);
    model.selectDestination('3011:bern');
    model.selectDestination('8001:zurich');
    expect(calls).toHaveLength(1);
  });
});

describe('createReachabilityBuckets', () => {
  it('includes only standard buckets up to the selected maximum', () => {
    expect(
      createReachabilityBuckets(
        [{ localityId: 'a', travelMinutes: 20 }],
        30,
      ),
    ).toEqual([
      { minutes: 15, localityCount: 0 },
      { minutes: 30, localityCount: 1 },
    ]);
  });
});
