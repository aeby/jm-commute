import { describe, expect, it } from 'vitest';

import type { TransitStop } from '../../../stops';
import { buildTransferGraph } from '../build-transfer-graph';
import {
  USE_QUERY_TRANSFER_TIME,
  type BuildTransferGraphOptions,
  type ParsedGtfsTransfer,
} from '../types';

const STOPS: readonly TransitStop[] = [
  {
    id: 'station',
    name: 'Station',
    latitude: 47,
    longitude: 8,
    kind: 'STATION',
  },
  {
    id: 'a',
    name: 'A',
    latitude: 47,
    longitude: 8,
    kind: 'STOP_OR_PLATFORM',
    parentStationId: 'station',
  },
  {
    id: 'b',
    name: 'B',
    latitude: 47.001,
    longitude: 8,
    kind: 'STOP_OR_PLATFORM',
    parentStationId: 'station',
  },
  {
    id: 'inactive',
    name: 'Inactive',
    latitude: 48,
    longitude: 9,
    kind: 'STOP_OR_PLATFORM',
  },
];

const rule = (
  overrides: Partial<ParsedGtfsTransfer> = {},
): ParsedGtfsTransfer => ({
  fromStopId: 'a',
  toStopId: 'b',
  transferType: 0,
  ...overrides,
});

const options = (
  transferRules: readonly ParsedGtfsTransfer[],
  overrides: Partial<BuildTransferGraphOptions> = {},
): BuildTransferGraphOptions => ({
  transferRules,
  activeServiceIds: new Set(['active']),
  transitStops: STOPS,
  denseStopLookup: new Map([
    ['a', 0],
    ['b', 1],
  ]),
  deriveSiblingTransfers: true,
  virtualTransfers: {
    enabled: false,
    maxDistanceMeters: 500,
    walkingSpeedKmh: 4,
    detourFactor: 1.3,
    changePenaltySeconds: 180,
  },
  ...overrides,
});

describe('buildTransferGraph', () => {
  it('builds supported generic edges and forbidden pairs with precedence', async () => {
    const result = await buildTransferGraph(
      options([
        rule(),
        rule({ fromStopId: 'b', toStopId: 'a', transferType: 3 }),
      ]),
    );

    expect(Array.from(result.transfersByStop[0] ?? [])).toEqual([
      1,
      USE_QUERY_TRANSFER_TIME,
    ]);
    expect(result.transfersByStop[1]).toHaveLength(0);
    expect(result.accessTransfersByStop[0]).toHaveLength(0);
    expect(result.statistics.gtfsSupportedEdges).toBe(1);
    expect(result.statistics.gtfsForbiddenPairs).toBe(1);
    expect(result.statistics.siblingEdgesGenerated).toBe(0);
  });

  it('requires and preserves the minimum time for generic type 2', async () => {
    const result = await buildTransferGraph(
      options([rule({ transferType: 2, minimumTransferTimeSeconds: 300 })], {
        deriveSiblingTransfers: false,
      }),
    );

    expect(Array.from(result.transfersByStop[0] ?? [])).toEqual([1, 300]);
    expect(Array.from(result.accessTransfersByStop[0] ?? [])).toEqual([
      1, 300,
    ]);
    expect(result.statistics.finalAccessTransferEdges).toBe(1);
    await expect(
      buildTransferGraph(
        options([rule({ transferType: 2 })], {
          deriveSiblingTransfers: false,
        }),
      ),
    ).rejects.toThrow(/requires min_transfer_time/i);
  });

  it('conservatively retains generic type 1 and reports approximation', async () => {
    const result = await buildTransferGraph(
      options([rule({ transferType: 1 })], {
        deriveSiblingTransfers: false,
      }),
    );

    expect(Array.from(result.transfersByStop[0] ?? [])).toEqual([
      1,
      USE_QUERY_TRANSFER_TIME,
    ]);
    expect(result.accessTransfersByStop[0]).toHaveLength(0);
    expect(result.statistics.timedTransfersApproximated).toBe(1);
  });

  it('classifies unsupported trip, route, and in-seat rows', async () => {
    const result = await buildTransferGraph(
      options(
        [
          rule({ transferType: 1, fromTripId: 'trip-a' }),
          rule({ fromRouteId: 'route-a' }),
          rule({ transferType: 4, fromTripId: 'trip-a' }),
          rule({ transferType: 5 }),
        ],
        { deriveSiblingTransfers: false },
      ),
    );

    expect(result.statistics.unsupportedTripSpecificRows).toBe(1);
    expect(result.statistics.unsupportedRouteSpecificRows).toBe(1);
    expect(result.statistics.unsupportedInSeatRows).toBe(2);
    expect(result.statistics.finalTransferEdges).toBe(0);
    expect(result.statistics.gtfsForbiddenPairs).toBe(0);
  });

  it('ignores inactive services and inactive routing stops with counts', async () => {
    const result = await buildTransferGraph(
      options(
        [
          rule({ serviceId: 'inactive-service' }),
          rule({ toStopId: 'inactive', serviceId: 'active' }),
          rule({ serviceId: 'active' }),
        ],
        { deriveSiblingTransfers: false },
      ),
    );

    expect(result.statistics.inactiveServiceRowsSkipped).toBe(1);
    expect(result.statistics.inactiveStopRowsSkipped).toBe(1);
    expect(result.statistics.gtfsSupportedEdges).toBe(1);
  });

  it('merges duplicate explicit rows conservatively and deterministically', async () => {
    const rules = [
      rule({ minimumTransferTimeSeconds: 120 }),
      rule({ transferType: 2, minimumTransferTimeSeconds: 300 }),
    ];
    const forward = await buildTransferGraph(
      options(rules, { deriveSiblingTransfers: false }),
    );
    const reverse = await buildTransferGraph(
      options(rules.toReversed(), { deriveSiblingTransfers: false }),
    );

    expect(forward.statistics.duplicateExplicitEdgesMerged).toBe(1);
    expect(reverse.transfersByStop).toEqual(forward.transfersByStop);
    expect(reverse.statistics).toEqual(forward.statistics);
  });

  it('leaves geographic transfers disabled by default', async () => {
    const result = await buildTransferGraph(
      options([], { deriveSiblingTransfers: false }),
    );

    expect(result.statistics.virtualEdgesGenerated).toBe(0);
    expect(result.statistics.finalTransferEdges).toBe(0);
  });

  it('marks generated sibling edges as initial-access eligible', async () => {
    const result = await buildTransferGraph(options([]));

    expect(result.statistics.siblingEdgesGenerated).toBe(2);
    expect(result.statistics.finalAccessTransferEdges).toBe(2);
    expect(result.accessTransfersByStop).toEqual(result.transfersByStop);
  });

  it('generates virtual transfers only when enabled', async () => {
    const result = await buildTransferGraph(
      options([], {
        deriveSiblingTransfers: false,
        virtualTransfers: {
          ...options([]).virtualTransfers,
          enabled: true,
        },
      }),
    );

    expect(result.statistics.virtualEdgesGenerated).toBe(2);
    expect(result.statistics.finalAccessTransferEdges).toBe(2);
    expect(result.accessTransfersByStop).toEqual(result.transfersByStop);
  });

  it('fails rather than guessing contradictory generic rules', async () => {
    await expect(
      buildTransferGraph(
        options([rule(), rule({ transferType: 3 })], {
          deriveSiblingTransfers: false,
        }),
      ),
    ).rejects.toThrow(/contradictory/i);
  });

  it('exposes optional deterministic transfer provenance diagnostics', async () => {
    const result = await buildTransferGraph(
      options([rule({ transferType: 2, minimumTransferTimeSeconds: 300 })], {
        deriveSiblingTransfers: false,
        includeDiagnostics: true,
      }),
    );

    expect(result.edgeDiagnostics).toEqual([
      {
        fromStopIndex: 0,
        toStopIndex: 1,
        minimumTransferTimeSeconds: 300,
        source: 'EXPLICIT',
        accessEligibility: 'ACCESS_ELIGIBLE',
        diagnosticSource: 'GTFS_TYPE_2',
      },
    ]);
  });
});
