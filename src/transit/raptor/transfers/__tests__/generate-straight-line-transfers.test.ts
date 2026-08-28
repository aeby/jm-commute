import { describe, expect, it } from 'vitest';

import { haversineDistanceMeters } from '../../../places';
import {
  calculateStraightLineTransferTimeSeconds,
  generateStraightLineTransfers,
} from '../generate-straight-line-transfers';
import { TransferEdgeRegistry } from '../merge-transfer-edges';
import type {
  ActiveTransferStop,
  StraightLineTransferOptions,
} from '../types';

const EARTH_RADIUS_METERS = 6_371_008.8;
const OPTIONS: StraightLineTransferOptions = {
  maxDistanceMeters: 500,
  walkingSpeedKmh: 4,
  detourFactor: 1.3,
  changePenaltySeconds: 180,
};

const stopAtMeters = (
  stopIndex: number,
  metersNorth: number,
): ActiveTransferStop => ({
  stopIndex,
  latitude: 47 + (metersNorth / EARTH_RADIUS_METERS) * (180 / Math.PI),
  longitude: 8,
});

describe('generateStraightLineTransfers', () => {
  it('connects stops inside the radius in both directions', () => {
    const registry = new TransferEdgeRegistry(2);

    expect(
      generateStraightLineTransfers(
        [stopAtMeters(0, 0), stopAtMeters(1, 400)],
        registry,
        OPTIONS,
      ),
    ).toBe(2);
    expect(registry.hasEdge(0, 1)).toBe(true);
    expect(registry.hasEdge(1, 0)).toBe(true);
  });

  it('does not connect stops beyond the radius', () => {
    const registry = new TransferEdgeRegistry(2);

    expect(
      generateStraightLineTransfers(
        [stopAtMeters(0, 0), stopAtMeters(1, 501)],
        registry,
        OPTIONS,
      ),
    ).toBe(0);
  });

  it('includes a pair exactly on the configured Haversine boundary', () => {
    const stops = [stopAtMeters(0, 0), stopAtMeters(1, 500)] as const;
    const left = stops[0];
    const right = stops[1];
    const distance = haversineDistanceMeters(
      { latitude: left.latitude!, longitude: left.longitude! },
      { latitude: right.latitude!, longitude: right.longitude! },
    );
    const registry = new TransferEdgeRegistry(2);

    expect(
      generateStraightLineTransfers(stops, registry, {
        ...OPTIONS,
        maxDistanceMeters: distance,
      }),
    ).toBe(2);
  });

  it('never connects a stop to itself and ignores missing coordinates', () => {
    const registry = new TransferEdgeRegistry(2);
    const missing: ActiveTransferStop = {
      stopIndex: 1,
    };

    expect(
      generateStraightLineTransfers(
        [stopAtMeters(0, 0), missing],
        registry,
        OPTIONS,
      ),
    ).toBe(0);
    expect(registry.hasEdge(0, 0)).toBe(false);
  });

  it('reflects walking speed, detour factor, and change penalty in duration', () => {
    const baseline = calculateStraightLineTransferTimeSeconds(400, OPTIONS);
    const slower = calculateStraightLineTransferTimeSeconds(400, {
      ...OPTIONS,
      walkingSpeedKmh: 2,
    });
    const detoured = calculateStraightLineTransferTimeSeconds(400, {
      ...OPTIONS,
      detourFactor: 2,
    });
    const penalized = calculateStraightLineTransferTimeSeconds(400, {
      ...OPTIONS,
      changePenaltySeconds: 300,
    });

    expect(slower).toBeGreaterThan(baseline);
    expect(detoured).toBeGreaterThan(baseline);
    expect(penalized - baseline).toBe(120);
  });

  it('does not replace explicit, forbidden, or sibling edges', () => {
    const registry = new TransferEdgeRegistry(3);
    registry.addExplicitEdge(0, 1, 900, 2);
    registry.addExplicitForbidden(1, 0);
    registry.addGeneratedEdge(0, 2, 120, 'SIBLING');

    generateStraightLineTransfers(
      [stopAtMeters(0, 0), stopAtMeters(1, 100), stopAtMeters(2, 200)],
      registry,
      OPTIONS,
    );

    expect(registry.getEdge(0, 1)?.minimumTransferTimeSeconds).toBe(900);
    expect(registry.hasEdge(1, 0)).toBe(false);
    expect(registry.getEdge(0, 2)?.source).toBe('SIBLING');
  });

  it('produces deterministic adjacency regardless of input order', () => {
    const stops = [
      stopAtMeters(0, 0),
      stopAtMeters(1, 100),
      stopAtMeters(2, 200),
    ];
    const forward = new TransferEdgeRegistry(3);
    const reverse = new TransferEdgeRegistry(3);

    generateStraightLineTransfers(stops, forward, OPTIONS);
    generateStraightLineTransfers(stops.toReversed(), reverse, OPTIONS);

    expect(reverse.toTransfersByStop()).toEqual(forward.toTransfersByStop());
  });

  it.each([
    [{ ...OPTIONS, maxDistanceMeters: 0 }, /maxDistanceMeters/],
    [{ ...OPTIONS, walkingSpeedKmh: 0 }, /walkingSpeedKmh/],
    [{ ...OPTIONS, detourFactor: 0.9 }, /detourFactor/],
    [{ ...OPTIONS, changePenaltySeconds: -1 }, /changePenaltySeconds/],
  ] as const)('rejects invalid options', (options, message) => {
    expect(() =>
      generateStraightLineTransfers([], new TransferEdgeRegistry(0), options),
    ).toThrow(message);
  });
});
