import { describe, expect, it } from 'vitest';

import {
  calculateMapBounds,
  calculateVisibleMapBounds,
} from '../map-bounds';
import type { LonLatPosition } from '../hex-grid';
import type { ReachabilityHex } from '../reachability-hexes';

const createHex = (
  id: string,
  travelMinutes: number,
  polygon: readonly LonLatPosition[],
): ReachabilityHex => ({ id, travelMinutes, polygon });

const NEAR_HEX = createHex('near', 30, [
  [7, 46],
  [8, 46],
  [8.5, 46.5],
  [8, 47],
  [7, 47],
  [6.5, 46.5],
]);

const FAR_HEX = createHex('far', 90, [
  [5, 44],
  [11, 44],
  [12, 46],
  [11, 49],
  [5, 49],
  [4, 46],
]);

describe('calculateMapBounds', () => {
  it('falls back exactly to the origin when there is no overlay', () => {
    expect(
      calculateMapBounds({ longitude: 7.4474, latitude: 46.948 }, []),
    ).toEqual({
      west: 7.4474,
      south: 46.948,
      east: 7.4474,
      north: 46.948,
    });
  });

  it('contains the origin and one visible hex', () => {
    expect(
      calculateMapBounds(
        { longitude: 7.5, latitude: 45.5 },
        [NEAR_HEX],
      ),
    ).toEqual({ west: 6.5, south: 45.5, east: 8.5, north: 47 });
  });

  it('contains the origin and several visible hexes', () => {
    expect(
      calculateMapBounds(
        { longitude: 7.5, latitude: 46.5 },
        [NEAR_HEX, FAR_HEX],
      ),
    ).toEqual({ west: 4, south: 44, east: 12, north: 49 });
  });

  it('does not swap longitude and latitude', () => {
    const bounds = calculateMapBounds(
      { longitude: 8, latitude: 47 },
      [createHex('order', 20, [
        [6, 48],
        [7, 48],
        [7.5, 48.5],
        [7, 49],
        [6, 49],
        [5.5, 48.5],
      ])],
    );

    expect(bounds.west).toBe(5.5);
    expect(bounds.east).toBe(8);
    expect(bounds.south).toBe(47);
    expect(bounds.north).toBe(49);
  });
});

describe('calculateVisibleMapBounds', () => {
  it('produces equal or smaller bounds for a smaller commute duration', () => {
    const origin = { longitude: 7.5, latitude: 46.5 };
    const smaller = calculateVisibleMapBounds(
      origin,
      [NEAR_HEX, FAR_HEX],
      30,
    );
    const larger = calculateVisibleMapBounds(
      origin,
      [NEAR_HEX, FAR_HEX],
      90,
    );

    expect(smaller.west).toBeGreaterThanOrEqual(larger.west);
    expect(smaller.south).toBeGreaterThanOrEqual(larger.south);
    expect(smaller.east).toBeLessThanOrEqual(larger.east);
    expect(smaller.north).toBeLessThanOrEqual(larger.north);
    expect(smaller).not.toEqual(larger);
  });

  it('falls back to the origin when no hex is within the selected duration', () => {
    const origin = { longitude: 8.5417, latitude: 47.3769 };

    expect(calculateVisibleMapBounds(origin, [NEAR_HEX], 15)).toEqual({
      west: origin.longitude,
      south: origin.latitude,
      east: origin.longitude,
      north: origin.latitude,
    });
  });
});
