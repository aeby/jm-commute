import { describe, expect, it } from 'vitest';

import type { ParsedGtfsTransfer } from '../../../prepare/gtfs/types';
import type { TransitStop } from '../../../prepare/stops';
import { USE_QUERY_TRANSFER_TIME } from '../../transfer-encoding';
import { buildTransferGraph } from '../build-transfer-graph';
import type {
  BuildTransferGraphOptions,
} from '../types';

const STOPS: readonly TransitStop[] = [
  {
    id: 'station',
    latitude: 47,
    longitude: 8,
    kind: 'STATION',
  },
  {
    id: 'a',
    latitude: 47,
    longitude: 8,
    kind: 'STOP_OR_PLATFORM',
    parentStationId: 'station',
  },
  {
    id: 'b',
    latitude: 47.001,
    longitude: 8,
    kind: 'STOP_OR_PLATFORM',
    parentStationId: 'station',
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
  transitStops: [],
  denseStopLookup: new Map([
    ['a', 0],
    ['b', 1],
  ]),
  ...overrides,
});

describe('buildTransferGraph', () => {
  it('builds generic edges while honoring forbidden directions', async () => {
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
  });

  it('requires and preserves the minimum time for generic type 2', async () => {
    const result = await buildTransferGraph(
      options([rule({ transferType: 2, minimumTransferTimeSeconds: 300 })]),
    );

    expect(Array.from(result.transfersByStop[0] ?? [])).toEqual([1, 300]);
    expect(Array.from(result.accessTransfersByStop[0] ?? [])).toEqual([
      1, 300,
    ]);
    await expect(
      buildTransferGraph(options([rule({ transferType: 2 })])),
    ).rejects.toThrow(/requires min_transfer_time/i);
  });

  it('retains generic type 1 using the query transfer time', async () => {
    const result = await buildTransferGraph(
      options([rule({ transferType: 1 })]),
    );

    expect(Array.from(result.transfersByStop[0] ?? [])).toEqual([
      1,
      USE_QUERY_TRANSFER_TIME,
    ]);
    expect(result.accessTransfersByStop[0]).toHaveLength(0);
  });

  it('ignores trip-specific, route-specific, and in-seat rules', async () => {
    const result = await buildTransferGraph(
      options([
        rule({ transferType: 1, fromTripId: 'trip-a' }),
        rule({ fromRouteId: 'route-a' }),
        rule({ transferType: 4, fromTripId: 'trip-a' }),
        rule({ transferType: 5 }),
      ]),
    );

    expect(result.transfersByStop).toEqual([
      new Uint32Array(),
      new Uint32Array(),
    ]);
  });

  it('ignores inactive services and stops', async () => {
    const result = await buildTransferGraph(
      options([
        rule({ serviceId: 'inactive-service' }),
        rule({ toStopId: 'inactive', serviceId: 'active' }),
        rule({ serviceId: 'active' }),
      ]),
    );

    expect(Array.from(result.transfersByStop[0] ?? [])).toEqual([
      1,
      USE_QUERY_TRANSFER_TIME,
    ]);
  });

  it('merges duplicate explicit rows deterministically', async () => {
    const rules = [
      rule({ minimumTransferTimeSeconds: 120 }),
      rule({ transferType: 2, minimumTransferTimeSeconds: 300 }),
    ];
    const forward = await buildTransferGraph(options(rules));
    const reverse = await buildTransferGraph(options(rules.toReversed()));

    expect(reverse.transfersByStop).toEqual(forward.transfersByStop);
    expect(reverse.accessTransfersByStop).toEqual(
      forward.accessTransfersByStop,
    );
  });

  it('adds sibling transfers and makes them initial-access eligible', async () => {
    const result = await buildTransferGraph(
      options([], { transitStops: STOPS }),
    );

    expect(result.accessTransfersByStop).toEqual(result.transfersByStop);
    expect(Array.from(result.transfersByStop[0] ?? [])).toEqual([
      1,
      USE_QUERY_TRANSFER_TIME,
    ]);
    expect(Array.from(result.transfersByStop[1] ?? [])).toEqual([
      0,
      USE_QUERY_TRANSFER_TIME,
    ]);
  });

  it('fails rather than guessing contradictory generic rules', async () => {
    await expect(
      buildTransferGraph(options([rule(), rule({ transferType: 3 })])),
    ).rejects.toThrow(/contradictory/i);
  });
});
