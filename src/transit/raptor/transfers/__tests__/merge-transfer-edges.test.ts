import { describe, expect, it } from 'vitest';

import { TransferEdgeRegistry } from '../merge-transfer-edges';
import { USE_QUERY_TRANSFER_TIME } from '../types';

describe('TransferEdgeRegistry', () => {
  it('keeps directed edges distinct and emits sorted typed adjacency', () => {
    const registry = new TransferEdgeRegistry(3);
    registry.addExplicitEdge(0, 2, 300, 0);
    registry.addExplicitEdge(0, 1, 120, 0);
    registry.addExplicitEdge(1, 0, 180, 0);

    expect(Array.from(registry.toTransfersByStop()[0] ?? [])).toEqual([
      1, 120, 2, 300,
    ]);
    expect(Array.from(registry.toTransfersByStop()[1] ?? [])).toEqual([
      0, 180,
    ]);
  });

  it('merges duplicate explicit edges using the largest numeric minimum', () => {
    const registry = new TransferEdgeRegistry(2);

    expect(registry.addExplicitEdge(0, 1, 120, 0)).toBe('ADDED');
    expect(registry.addExplicitEdge(0, 1, 300, 2)).toBe('MERGED');
    expect(registry.getEdge(0, 1)?.minimumTransferTimeSeconds).toBe(300);
  });

  it('lets a numeric minimum take precedence over query fallback', () => {
    const registry = new TransferEdgeRegistry(2);
    registry.addExplicitEdge(0, 1, USE_QUERY_TRANSFER_TIME, 0);
    registry.addExplicitEdge(0, 1, 240, 2);
    registry.addExplicitEdge(0, 1, USE_QUERY_TRANSFER_TIME, 1);

    expect(registry.getEdge(0, 1)?.minimumTransferTimeSeconds).toBe(240);
    expect(Array.from(registry.toAccessTransfersByStop()[0] ?? [])).toEqual([
      1, 240,
    ]);
    expect(registry.getEdge(0, 1)?.diagnosticSource).toBe('GTFS_TYPE_2');
  });

  it('fails for contradictory explicit allowed and forbidden rules', () => {
    const allowedFirst = new TransferEdgeRegistry(2);
    allowedFirst.addExplicitEdge(0, 1, 120, 0);
    expect(() => allowedFirst.addExplicitForbidden(0, 1)).toThrow(
      /contradictory/i,
    );

    const forbiddenFirst = new TransferEdgeRegistry(2);
    forbiddenFirst.addExplicitForbidden(0, 1);
    expect(() => forbiddenFirst.addExplicitEdge(0, 1, 120, 0)).toThrow(
      /contradictory/i,
    );
  });

  it('never lets generated edges replace explicit or forbidden pairs', () => {
    const registry = new TransferEdgeRegistry(3);
    registry.addExplicitEdge(0, 1, 300, 2);
    registry.addExplicitForbidden(0, 2);

    expect(registry.addGeneratedEdge(0, 1, 120, 'SIBLING')).toBe(false);
    expect(registry.addGeneratedEdge(0, 2, 120, 'VIRTUAL')).toBe(false);
    expect(registry.getEdge(0, 1)?.minimumTransferTimeSeconds).toBe(300);
  });

  it('keeps ordinary explicit edges out of initial access', () => {
    const registry = new TransferEdgeRegistry(2);
    registry.addExplicitEdge(0, 1, 120, 0);

    expect(registry.toAccessTransfersByStop()[0]).toHaveLength(0);
    expect(registry.accessEdgeCount).toBe(0);
  });
});
