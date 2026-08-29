import { describe, expect, it } from 'vitest';

import {
  buildDenseStopIds,
  buildSourceStopIndex,
} from '../dense-stop-ids';

describe('network dense stop IDs', () => {
  it('sorts opaque source IDs and assigns contiguous numeric IDs', () => {
    const result = buildDenseStopIds(['stop-z', 'stop-a', 'stop-m']);

    expect(result.sourceStopIds).toEqual(['stop-a', 'stop-m', 'stop-z']);
    expect([...result.stopIndexBySourceId.values()]).toEqual([0, 1, 2]);
  });

  it('supports source-to-numeric and numeric-to-source lookup', () => {
    const result = buildDenseStopIds(['opaque:42', 'ch:1:sloid:x']);

    const numericId = result.stopIndexBySourceId.get('opaque:42');
    expect(numericId).toBe(1);
    expect(result.sourceStopIds[numericId ?? -1]).toBe('opaque:42');
  });

  it('does not depend on input ordering or duplicate occurrences', () => {
    const forward = buildDenseStopIds(['c', 'a', 'b', 'a']);
    const reverse = buildDenseStopIds(['a', 'b', 'a', 'c']);

    expect(reverse.sourceStopIds).toEqual(forward.sourceStopIds);
    expect([...reverse.stopIndexBySourceId]).toEqual([
      ...forward.stopIndexBySourceId,
    ]);
  });

  it('does not interpret or rewrite opaque GTFS identifiers', () => {
    const opaqueIds = ['12', 'ch:1:sloid:8503000:0:7', 'parent/stop#x'];
    const result = buildDenseStopIds(opaqueIds);

    expect(new Set(result.sourceStopIds)).toEqual(new Set(opaqueIds));
  });

  it('rejects empty source stop IDs', () => {
    expect(() => buildDenseStopIds(['valid', ''])).toThrow(
      /nonempty string/i,
    );
  });
});

describe('buildSourceStopIndex', () => {
  it('builds the timetable-boundary string lookup once', () => {
    expect([...buildSourceStopIndex(['opaque-b', 'opaque-a'])]).toEqual([
      ['opaque-b', 0],
      ['opaque-a', 1],
    ]);
  });

  it('rejects duplicate source IDs', () => {
    expect(() => buildSourceStopIndex(['duplicate', 'duplicate'])).toThrow(
      /duplicate source stop id/i,
    );
  });
});
