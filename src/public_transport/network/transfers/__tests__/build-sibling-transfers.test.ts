import { describe, expect, it } from 'vitest';

import type { TransitStop } from '../../../prepare/stops';
import { USE_QUERY_TRANSFER_TIME } from '../../transfer-encoding';
import { buildSiblingTransfers } from '../build-sibling-transfers';
import { TransferEdgeRegistry } from '../merge-transfer-edges';

const station = (id: string): TransitStop => ({
  id,
  latitude: 47,
  longitude: 8,
  kind: 'STATION',
});

const platform = (id: string, parentStationId: string): TransitStop => ({
  id,
  latitude: 47,
  longitude: 8,
  kind: 'STOP_OR_PLATFORM',
  parentStationId,
});

const stops = [
  station('parent'),
  platform('a', 'parent'),
  platform('b', 'parent'),
];
const lookup = new Map([
  ['a', 0],
  ['b', 1],
]);

describe('buildSiblingTransfers', () => {
  it('connects active siblings both ways using query transfer time', () => {
    const registry = new TransferEdgeRegistry(2);
    buildSiblingTransfers(stops, lookup, registry);

    expect(registry.toTransfersByStop()).toEqual([
      new Uint32Array([1, USE_QUERY_TRANSFER_TIME]),
      new Uint32Array([0, USE_QUERY_TRANSFER_TIME]),
    ]);
    expect(registry.toAccessTransfersByStop()).toEqual(
      registry.toTransfersByStop(),
    );
  });

  it('ignores inactive children and stations with one active child', () => {
    const registry = new TransferEdgeRegistry(1);
    buildSiblingTransfers(stops, new Map([['a', 0]]), registry);

    expect(registry.toTransfersByStop()).toEqual([new Uint32Array()]);
  });

  it('preserves explicit and forbidden directions', () => {
    const explicit = new TransferEdgeRegistry(2);
    explicit.addExplicitEdge(0, 1, 300, 2);
    buildSiblingTransfers(stops, lookup, explicit);
    expect(explicit.toTransfersByStop()).toEqual([
      new Uint32Array([1, 300]),
      new Uint32Array([0, USE_QUERY_TRANSFER_TIME]),
    ]);

    const forbidden = new TransferEdgeRegistry(2);
    forbidden.addExplicitForbidden(0, 1);
    buildSiblingTransfers(stops, lookup, forbidden);
    expect(forbidden.toTransfersByStop()).toEqual([
      new Uint32Array(),
      new Uint32Array([0, USE_QUERY_TRANSFER_TIME]),
    ]);
  });

  it('does not create duplicates when generated repeatedly', () => {
    const registry = new TransferEdgeRegistry(2);
    buildSiblingTransfers(stops, lookup, registry);
    buildSiblingTransfers(stops, lookup, registry);

    expect(registry.toTransfersByStop()[0]).toHaveLength(2);
    expect(registry.toTransfersByStop()[1]).toHaveLength(2);
  });
});
