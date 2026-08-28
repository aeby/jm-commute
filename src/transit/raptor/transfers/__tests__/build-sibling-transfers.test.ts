import { describe, expect, it } from 'vitest';

import type { TransitStop } from '../../../stops';
import { USE_QUERY_TRANSFER_TIME } from '../../transfer-encoding';
import { buildSiblingTransfers } from '../build-sibling-transfers';
import { TransferEdgeRegistry } from '../merge-transfer-edges';

const station = (id: string): TransitStop => ({
  id,
  name: id,
  latitude: 47,
  longitude: 8,
  kind: 'STATION',
});

const platform = (id: string, parentStationId: string): TransitStop => ({
  id,
  name: id,
  latitude: 47,
  longitude: 8,
  kind: 'STOP_OR_PLATFORM',
  parentStationId,
});

describe('buildSiblingTransfers', () => {
  it('connects two active siblings both ways using query transfer time', () => {
    const registry = new TransferEdgeRegistry(2);
    const generated = buildSiblingTransfers(
      [station('parent'), platform('a', 'parent'), platform('b', 'parent')],
      new Map([
        ['a', 0],
        ['b', 1],
      ]),
      registry,
    );

    expect(generated).toBe(2);
    expect(registry.getEdge(0, 1)?.minimumTransferTimeSeconds).toBe(
      USE_QUERY_TRANSFER_TIME,
    );
    expect(registry.getEdge(1, 0)?.minimumTransferTimeSeconds).toBe(
      USE_QUERY_TRANSFER_TIME,
    );
  });

  it('forms a complete directed graph for three siblings', () => {
    const registry = new TransferEdgeRegistry(3);

    expect(
      buildSiblingTransfers(
        [
          station('parent'),
          platform('a', 'parent'),
          platform('b', 'parent'),
          platform('c', 'parent'),
        ],
        new Map([
          ['a', 0],
          ['b', 1],
          ['c', 2],
        ]),
        registry,
      ),
    ).toBe(6);
  });

  it('ignores inactive children and stations with one active child', () => {
    const registry = new TransferEdgeRegistry(1);

    expect(
      buildSiblingTransfers(
        [station('parent'), platform('a', 'parent'), platform('b', 'parent')],
        new Map([['a', 0]]),
        registry,
      ),
    ).toBe(0);
  });

  it('preserves an explicit edge and fills only the missing reverse edge', () => {
    const registry = new TransferEdgeRegistry(2);
    registry.addExplicitEdge(0, 1, 300, 2);

    expect(
      buildSiblingTransfers(
        [station('parent'), platform('a', 'parent'), platform('b', 'parent')],
        new Map([
          ['a', 0],
          ['b', 1],
        ]),
        registry,
      ),
    ).toBe(1);
    expect(registry.getEdge(0, 1)?.minimumTransferTimeSeconds).toBe(300);
    expect(registry.getEdge(1, 0)?.source).toBe('SIBLING');
  });

  it('respects a forbidden direction while generating the reverse', () => {
    const registry = new TransferEdgeRegistry(2);
    registry.addExplicitForbidden(0, 1);

    expect(
      buildSiblingTransfers(
        [station('parent'), platform('a', 'parent'), platform('b', 'parent')],
        new Map([
          ['a', 0],
          ['b', 1],
        ]),
        registry,
      ),
    ).toBe(1);
    expect(registry.hasEdge(0, 1)).toBe(false);
    expect(registry.hasEdge(1, 0)).toBe(true);
  });

  it('does not create duplicates on repeated generation', () => {
    const registry = new TransferEdgeRegistry(2);
    const stops = [
      station('parent'),
      platform('a', 'parent'),
      platform('b', 'parent'),
    ];
    const lookup = new Map([
      ['a', 0],
      ['b', 1],
    ]);

    expect(buildSiblingTransfers(stops, lookup, registry)).toBe(2);
    expect(buildSiblingTransfers(stops, lookup, registry)).toBe(0);
  });
});
