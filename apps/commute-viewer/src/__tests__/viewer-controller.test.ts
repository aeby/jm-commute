import { describe, expect, it, vi } from 'vitest';

import type {
  CommuteMode,
  ReachabilityFeatureCollection,
  ReachabilityResponse,
} from '../api/types';
import {
  countVisibleHexagons,
  ViewerReachabilityCoordinator,
} from '../viewer-controller';

type LoadReachability = (
  originLocalityId: string,
  mode: CommuteMode,
  signal?: AbortSignal,
) => Promise<ReachabilityResponse>;

const response = (
  originLocalityId: string,
  mode: CommuteMode,
): ReachabilityResponse => ({
  origin: {
    localityId: originLocalityId,
    longitude: 8.54,
    latitude: 47.37,
  },
  mode,
  maxTravelMinutes: 240,
  reachableLocalityCount: 1,
  hexagonCount: 0,
  geojson: { type: 'FeatureCollection', features: [] },
  bounds: { west: 8.54, south: 47.37, east: 8.54, north: 47.37 },
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('ViewerReachabilityCoordinator', () => {
  it('makes one request per origin or mode load', async () => {
    const loadReachability = vi.fn<LoadReachability>(
      async (originLocalityId: string, mode: CommuteMode) =>
        response(originLocalityId, mode),
    );
    const coordinator = new ViewerReachabilityCoordinator({ loadReachability });

    await coordinator.load('8001:zurich', 'transit');
    await coordinator.load('3011:bern', 'transit');
    await coordinator.load('3011:bern', 'car');

    expect(loadReachability).toHaveBeenCalledTimes(3);
    expect(loadReachability.mock.calls.map(([origin, mode]) => [origin, mode]))
      .toEqual([
        ['8001:zurich', 'transit'],
        ['3011:bern', 'transit'],
        ['3011:bern', 'car'],
      ]);
  });

  it('aborts the old request and never returns its stale result', async () => {
    const requests: Array<{
      readonly result: Deferred<ReachabilityResponse>;
      readonly signal: AbortSignal | undefined;
    }> = [];
    const loadReachability = vi.fn<LoadReachability>(
      (
        _originLocalityId: string,
        _mode: CommuteMode,
        signal?: AbortSignal,
      ): Promise<ReachabilityResponse> => {
        const result = deferred<ReachabilityResponse>();
        requests.push({ result, signal });
        return result.promise;
      },
    );
    const coordinator = new ViewerReachabilityCoordinator({ loadReachability });

    const first = coordinator.load('8001:zurich', 'transit');
    const second = coordinator.load('3011:bern', 'car');
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(requests[1]?.signal?.aborted).toBe(false);

    requests[1]!.result.resolve(response('3011:bern', 'car'));
    await expect(second).resolves.toMatchObject({
      response: { origin: { localityId: '3011:bern' }, mode: 'car' },
    });
    requests[0]!.result.resolve(response('8001:zurich', 'transit'));
    await expect(first).resolves.toBeUndefined();
  });

  it('suppresses stale errors but exposes current errors for recovery', async () => {
    const first = deferred<ReachabilityResponse>();
    const loadReachability = vi.fn<LoadReachability>()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('API offline'))
      .mockResolvedValueOnce(response('8001:zurich', 'car'));
    const coordinator = new ViewerReachabilityCoordinator({ loadReachability });

    const stale = coordinator.load('3011:bern', 'transit');
    await expect(coordinator.load('8001:zurich', 'transit'))
      .rejects.toThrow('API offline');
    first.reject(new Error('Old failure'));
    await expect(stale).resolves.toBeUndefined();
    await expect(coordinator.load('8001:zurich', 'car')).resolves.toMatchObject({
      response: { mode: 'car' },
    });
  });

  it('can invalidate an in-flight request when the origin is cleared', async () => {
    const result = deferred<ReachabilityResponse>();
    let signal: AbortSignal | undefined;
    const coordinator = new ViewerReachabilityCoordinator({
      loadReachability: (_origin, _mode, requestSignal) => {
        signal = requestSignal;
        return result.promise;
      },
    });
    const pending = coordinator.load('8001:zurich', 'transit');

    coordinator.invalidate();
    expect(signal?.aborted).toBe(true);
    result.resolve(response('8001:zurich', 'transit'));
    await expect(pending).resolves.toBeUndefined();
  });

  it('measures the successful API request', async () => {
    let clock = 10;
    const coordinator = new ViewerReachabilityCoordinator(
      {
        loadReachability: async () => response('8001:zurich', 'transit'),
      },
      { now: () => (clock += 7) },
    );

    await expect(coordinator.load('8001:zurich', 'transit')).resolves
      .toMatchObject({ requestMilliseconds: 7 });
  });
});

describe('local slider visibility', () => {
  const featureCollection: ReachabilityFeatureCollection = {
    type: 'FeatureCollection',
    features: [15, 30, 120, 180, 240].map((travelMinutes) => ({
      type: 'Feature',
      properties: { travelMinutes },
      geometry: {
        type: 'Polygon',
        coordinates: [[[8, 47], [9, 47], [9, 48], [8, 47]]],
      },
    })),
  };

  it('counts the cached 240-minute GeoJSON using an inclusive local threshold', () => {
    expect(countVisibleHexagons(featureCollection, 15)).toBe(1);
    expect(countVisibleHexagons(featureCollection, 120)).toBe(3);
    expect(countVisibleHexagons(featureCollection, 240)).toBe(5);
  });

  it('does not need or call an API client when the slider changes', () => {
    const loadReachability = vi.fn<LoadReachability>();
    const selectedMinutes = [15, 30, 60, 120, 180, 240];

    expect(
      selectedMinutes.map((minutes) =>
        countVisibleHexagons(featureCollection, minutes),
      ),
    ).toEqual([1, 2, 2, 3, 4, 5]);
    expect(loadReachability).not.toHaveBeenCalled();
  });
});
