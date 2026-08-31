import { describe, expect, it } from 'vitest';

import type { Locality } from '@jm/commute';

import { buildNetwork } from '../build-network';
import type { RoadRouter } from '../types';

const localities: readonly Locality[] = [
  {
    localityId: '1000:alpha',
    postalCode: '1000',
    city: 'Alpha',
    latitude: 46.1,
    longitude: 7.1,
  },
  {
    localityId: '2000:beta',
    postalCode: '2000',
    city: 'Beta',
    latitude: 47.2,
    longitude: 8.2,
  },
];
const preparedData = {
  localities,
  roadGraph: {
    sourcePbfSha256: 'a'.repeat(64),
    osrmVersion: '26.8.0',
    profile: 'car.lua',
    algorithm: 'ch',
  },
} as const;

function router(): RoadRouter {
  return {
    async findNearestRoadPoint(coordinate) {
      return {
        latitude: coordinate.latitude + 0.001,
        longitude: coordinate.longitude + 0.002,
        distanceMeters: 12,
      };
    },
    async getDurationTable() {
      return { durationsSeconds: [] };
    },
    async estimateRoute() {
      return undefined;
    },
  };
}

describe('buildNetwork', () => {
  it('derives ordered locality anchors and stable fingerprints in memory', async () => {
    const first = await buildNetwork({
      preparedData,
      router: router(),
      concurrency: 2,
    });
    const second = await buildNetwork({
      preparedData,
      router: router(),
      concurrency: 1,
    });

    expect(first.localities).toEqual([
      {
        localityId: '1000:alpha',
        latitude: 46.101,
        longitude: 7.101999999999999,
        snapDistanceMeters: 12,
      },
      {
        localityId: '2000:beta',
        latitude: 47.201,
        longitude: 8.202,
        snapDistanceMeters: 12,
      },
    ]);
    expect(first.localityInputSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(second.anchorsSha256).toBe(first.anchorsSha256);
  });

  it('bounds nearest requests and reports aggregate failures', async () => {
    let active = 0;
    let peak = 0;
    const failingRouter = router();
    failingRouter.findNearestRoadPoint = async (coordinate) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      throw new Error(`no road at ${coordinate.latitude}`);
    };

    await expect(
      buildNetwork({ preparedData, router: failingRouter, concurrency: 1 }),
    ).rejects.toThrow('Unable to anchor 2 of 2');
    expect(peak).toBe(1);
  });
});
