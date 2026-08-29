import { describe, expect, it } from 'vitest';

import { buildLocalityRoutingIndex } from '../build-locality-routing-index';

describe('buildLocalityRoutingIndex', () => {
  it('maps source stop IDs to unique sorted dense indexes', () => {
    const index = buildLocalityRoutingIndex(
      [
        {
          localityId: '8001:zurich',
          sourceStopIds: ['stop-c', 'inactive', 'stop-a', 'stop-c'],
        },
        {
          localityId: '3011:bern',
          sourceStopIds: [],
        },
      ],
      new Map([
        ['stop-a', 2],
        ['stop-c', 0],
      ]),
    );

    expect(index.entries).toEqual([
      {
        localityId: '8001:zurich',
        stopIndexes: new Uint32Array([0, 2]),
      },
      {
        localityId: '3011:bern',
        stopIndexes: new Uint32Array(),
      },
    ]);
  });

  it('rejects duplicate localities and invalid dense indexes', () => {
    expect(() =>
      buildLocalityRoutingIndex(
        [
          { localityId: '8001:zurich', sourceStopIds: [] },
          { localityId: '8001:zurich', sourceStopIds: [] },
        ],
        new Map(),
      ),
    ).toThrow(/duplicate/i);

    expect(() =>
      buildLocalityRoutingIndex(
        [{ localityId: '8001:zurich', sourceStopIds: ['stop-a'] }],
        new Map([['stop-a', -1]]),
      ),
    ).toThrow(/Uint32/i);
  });
});
