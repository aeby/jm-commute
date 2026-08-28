import { describe, expect, it, vi } from 'vitest';

import { PROJECT_CONFIG } from '@core/config';
import { UNREACHED_TIME } from '@core/transit/raptor/routing/state';
import type { FastestWindowResult } from '@core/transit/raptor/routing/types';
import type { RaptorTimetable } from '@core/transit/raptor/timetable/types';

import { VIEWER_CONFIG } from '../config';
import type {
  ReachabilityHex,
  ReachableStopSample,
} from '../map/reachability-hexes';
import {
  countVisibleReachabilityHexes,
  countVisibleReachableStops,
  createBrowserViewerRoutingEngine,
  getVisibleReachabilityHexes,
  ViewerOriginRoutingCoordinator,
  type FastestWindowRunner,
  type ViewerRoutingEngine,
} from '../viewer-routing';

const timetable = (stopCount: number): RaptorTimetable => ({
  sourceStopIds: Array.from({ length: stopCount }, (_, index) => `s${index}`),
  patterns: [],
  patternOccurrencesByStop: Array.from(
    { length: stopCount },
    () => new Uint32Array(),
  ),
  transfersByStop: Array.from(
    { length: stopCount },
    () => new Uint32Array(),
  ),
  accessTransfersByStop: Array.from(
    { length: stopCount },
    () => new Uint32Array(),
  ),
});

const routingResult = (
  durations: readonly number[],
): FastestWindowResult => {
  const departure = 28_800;
  return {
    durationSeconds: Uint32Array.from(durations),
    departureTimes: Uint32Array.from(
      durations,
      (duration) => duration === UNREACHED_TIME ? UNREACHED_TIME : departure,
    ),
    arrivalTimes: Uint32Array.from(
      durations,
      (duration) =>
        duration === UNREACHED_TIME
          ? UNREACHED_TIME
          : departure + duration,
    ),
  };
};

const runtime = (stopCount: number) => ({
  timetable: timetable(stopCount),
  routingWindowStart: '07:00:00',
  routingWindowEnd: '09:00:00',
});

const immediateCoordinator = (
  engine: ViewerRoutingEngine,
  coordinates: Float32Array,
): ViewerOriginRoutingCoordinator =>
  new ViewerOriginRoutingCoordinator(engine, coordinates, {
    yieldBeforeRouting: () => undefined,
  });

const hex = (id: string, travelMinutes: number): ReachabilityHex => ({
  id,
  travelMinutes,
  polygon: [],
});

const sample = (travelMinutes: number): ReachableStopSample => ({
  longitude: 8,
  latitude: 47,
  travelMinutes,
});

describe('browser viewer routing engine', () => {
  it('runs fastest-window RAPTOR exactly once at the 120-minute maximum', async () => {
    const expectedResult = routingResult([0, 1_800]);
    const runFastestWindow = vi.fn<FastestWindowRunner>(
      () => expectedResult,
    );
    const engine = createBrowserViewerRoutingEngine(runtime(2), {
      runFastestWindow,
    });
    const coordinator = immediateCoordinator(
      engine,
      Float32Array.of(8.54, 47.37, 7.45, 46.95),
    );

    const outcome = await coordinator.calculateOrigin({
      localityId: '8001:zurich',
      stopIndexes: Uint32Array.of(0),
    });

    expect(outcome?.routingResult).toBe(expectedResult);
    expect(runFastestWindow).toHaveBeenCalledTimes(1);
    expect(runFastestWindow).toHaveBeenCalledWith(
      expect.anything(),
      {
        originStopIndexes: [0],
        windowStartSeconds: 7 * 60 * 60,
        windowEndSeconds: 9 * 60 * 60,
        maxTravelTimeSeconds:
          VIEWER_CONFIG.commute.maximumMinutes * 60,
        maxTransfers: PROJECT_CONFIG.transit.routing.maxTransfers,
        minTransferTimeSeconds:
          PROJECT_CONFIG.transit.routing.minTransferTimeSeconds,
      },
    );
    const query = runFastestWindow.mock.calls[0]?.[1];
    expect(query).toBeDefined();
    expect(query).not.toHaveProperty('departureTimeSeconds');
  });

  it('filters cached slider results without rerunning RAPTOR', async () => {
    const runFastestWindow = vi.fn<FastestWindowRunner>(() =>
      routingResult([600, 1_800, 3_600]),
    );
    const coordinator = immediateCoordinator(
      createBrowserViewerRoutingEngine(runtime(3), { runFastestWindow }),
      Float32Array.of(7, 46, 8, 47, 9, 48),
    );
    const outcome = await coordinator.calculateOrigin({
      localityId: '3011:bern',
      stopIndexes: Uint32Array.of(0),
    });
    expect(outcome).toBeDefined();

    const visibleAt30 = getVisibleReachabilityHexes(outcome!.hexes, 30);
    const visibleAt60 = getVisibleReachabilityHexes(outcome!.hexes, 60);
    const stopsAt30 = countVisibleReachableStops(
      outcome!.reachableStopSamples,
      30,
    );
    const hexesAt60 = countVisibleReachabilityHexes(outcome!.hexes, 60);

    expect(visibleAt30.length).toBeLessThanOrEqual(visibleAt60.length);
    expect(stopsAt30).toBe(2);
    expect(hexesAt60).toBe(visibleAt60.length);
    expect(runFastestWindow).toHaveBeenCalledTimes(1);
  });
});

describe('ViewerOriginRoutingCoordinator', () => {
  it('ignores a superseded asynchronous origin outcome', async () => {
    interface Deferred {
      readonly promise: Promise<FastestWindowResult>;
      readonly resolve: (result: FastestWindowResult) => void;
    }
    const deferredResults: Deferred[] = [];
    const engine: ViewerRoutingEngine = {
      run: vi.fn<ViewerRoutingEngine['run']>(() => {
        let resolve!: (result: FastestWindowResult) => void;
        const promise = new Promise<FastestWindowResult>((complete) => {
          resolve = complete;
        });
        deferredResults.push({ promise, resolve });
        return promise;
      }),
    };
    const coordinator = immediateCoordinator(
      engine,
      Float32Array.of(8, 47),
    );

    const first = coordinator.calculateOrigin({
      localityId: '8001:zurich',
      stopIndexes: Uint32Array.of(0),
    });
    await Promise.resolve();
    expect(deferredResults).toHaveLength(1);

    const second = coordinator.calculateOrigin({
      localityId: '3011:bern',
      stopIndexes: Uint32Array.of(0),
    });
    await Promise.resolve();
    expect(deferredResults).toHaveLength(2);

    deferredResults[1]?.resolve(routingResult([1_800]));
    expect((await second)?.originLocalityId).toBe('3011:bern');
    deferredResults[0]?.resolve(routingResult([600]));
    expect(await first).toBeUndefined();
  });

  it('converts stop durations from seconds to fractional minutes', async () => {
    let clock = 0;
    const coordinator = new ViewerOriginRoutingCoordinator(
      { run: () => routingResult([90]) },
      Float32Array.of(8.54, 47.37),
      {
        yieldBeforeRouting: () => Promise.resolve(),
        now: () => clock++,
      },
    );

    const outcome = await coordinator.calculateOrigin({
      localityId: '8001:zurich',
      stopIndexes: Uint32Array.of(0),
    });

    expect(outcome?.reachableStopSamples).toHaveLength(1);
    expect(outcome?.reachableStopSamples[0]?.longitude).toBeCloseTo(8.54, 5);
    expect(outcome?.reachableStopSamples[0]?.latitude).toBeCloseTo(47.37, 5);
    expect(outcome?.reachableStopSamples[0]?.travelMinutes).toBe(1.5);
    expect(outcome?.featureCollection.type).toBe('FeatureCollection');
    expect(outcome?.featureCollection.features).toHaveLength(1);
    expect(outcome?.timings).toEqual({
      raptorMilliseconds: 1,
      stopSamplingMilliseconds: 1,
      hexAggregationMilliseconds: 1,
      geoJsonMilliseconds: 1,
    });
  });

  it('rejects an origin with no active routing stops', async () => {
    const run = vi.fn<ViewerRoutingEngine['run']>(() => routingResult([0]));
    const coordinator = immediateCoordinator(
      { run },
      Float32Array.of(8, 47),
    );

    await expect(
      coordinator.calculateOrigin({
        localityId: '1000:none',
        stopIndexes: new Uint32Array(),
      }),
    ).rejects.toThrow(/no active routing stops/i);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('cached reachability visibility helpers', () => {
  it('uses an inclusive selected-minute threshold', () => {
    const hexes = [hex('before', 29.99), hex('at', 30), hex('after', 30.01)];
    const samples = [sample(29.99), sample(30), sample(30.01)];

    expect(getVisibleReachabilityHexes(hexes, 30).map(({ id }) => id))
      .toEqual(['before', 'at']);
    expect(countVisibleReachabilityHexes(hexes, 30)).toBe(2);
    expect(countVisibleReachableStops(samples, 30)).toBe(2);
  });
});
